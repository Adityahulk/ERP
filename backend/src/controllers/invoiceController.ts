import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { calculateInvoiceTotals, determineGSTType } from '../services/gstService';
import { generateInvoicePDF, generateThermalReceipt, generateEinvoicePdf } from '../services/pdfService';
import { sendWhatsAppInvoiceLink } from '../services/notificationService';
import {
  buildEinvoicePayload,
  generateIRN,
  generateEinvoiceQR,
  cancelIRN,
  generateEwayBill as generateEwayBillViaService,
  cancelEwayBill as cancelEwayBillViaService,
  type EinvoiceItemRow,
} from '../services/eInvoiceService';
import { redis } from '../config/redis';
import { env } from '../config/env';
import {
  resolveBankSnapshotsForInsert,
  resolveCompanyRowForInvoicePdf,
  type Queryable,
} from '../lib/bankAccountSnapshots';

const ALLOWED_PDF_TEMPLATES = ['standard', 'simple', 'performa'] as const;
const ALLOWED_DOCUMENT_THEMES = [
  'classic', 'modern', 'compact', 'executive', 'sunrise',
  'forest', 'midnight', 'royal', 'slate', 'retail', 'minimal',
] as const;

function paymentStatusFor(totalAmount: number, paidAmount: number): 'unpaid' | 'partial' | 'paid' {
  if (paidAmount >= totalAmount) return 'paid';
  if (paidAmount > 0) return 'partial';
  return 'unpaid';
}

function externalTaxErrorStatus(message: string): number {
  return /TaxPro|GSP credentials|EINVOICE_|GSTIN|e-invoice auth|e-way auth/i.test(message) ? 400 : 500;
}

async function generateInvoiceNumber(companyId: string, invoiceKind: string, godownId: string | null): Promise<string> {
  const prefixRes = await query('SELECT invoice_prefix FROM companies WHERE id = $1', [companyId]);
  const defaultPrefix = invoiceKind === 'purchase' ? 'PUR' : 'INV';
  const prefix = prefixRes.rows[0]?.invoice_prefix || defaultPrefix;

  const now = new Date();
  const month = now.getMonth();
  const yearStr = now.getFullYear().toString().slice(-2);
  const nextYearStr = (now.getFullYear() + 1).toString().slice(-2);
  const prevYearStr = (now.getFullYear() - 1).toString().slice(-2);
  const fyShort = month >= 3 ? `${yearStr}-${nextYearStr}` : `${prevYearStr}-${yearStr}`;

  const branchCode = godownId ? 'GW' : 'HQ';

  const redisKey = `seq:invoice:${companyId}:${fyShort}:${invoiceKind}`;
  let seq = 1;

  if (redis) {
    try {
      seq = await redis.incr(redisKey);
    } catch {
      const dbRes = await query(
        `SELECT COUNT(*)::int as count FROM invoices WHERE company_id = $1 AND is_deleted = false AND created_at >= $2`,
        [companyId, new Date(now.getFullYear(), 0, 1).toISOString()]
      );
      seq = (dbRes.rows[0]?.count || 0) + 1;
    }
  }

  const paddedSeq = String(seq).padStart(4, '0');
  return `${prefix}/${branchCode}/${fyShort}${paddedSeq}`;
}

function mapLineForGst(raw: any) {
  const unitPrice = Math.round(Number(raw.unit_price) || 0);
  const qty = Number(raw.quantity) || 0;
  const base = unitPrice * qty;
  const pct = Number(raw.discount_percent) || 0;
  const flatFromPct = pct > 0 ? Math.round((base * pct) / 100) : 0;
  const lineDisc = Math.round(Number(raw.discount_amount) || 0) || flatFromPct;
  return {
    unit_price: unitPrice,
    quantity: qty,
    gst_rate: Number(raw.gst_rate) || 0,
    cess_rate: Number(raw.cess_rate) || 0,
    discount_type: lineDisc > 0 ? ('flat' as const) : ('none' as const),
    discount_value: lineDisc,
  };
}

function invoiceLineName(item: any): string {
  const value = item.item_name ?? item.name ?? item.description ?? item.item_description;
  const text = String(value ?? '').trim();
  if (text) return text;
  return item.is_text_row ? ' ' : 'Item';
}

async function backupInvoiceSnapshot(client: any, companyId: string, invoiceId: string, action: string, createdBy: string) {
  const inv = await client.query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2`, [invoiceId, companyId]);
  const items = await client.query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
    [invoiceId, companyId],
  );
  const payments = await client.query(
    `SELECT p.*
     FROM payments p
     JOIN payment_allocations pa ON pa.payment_id = p.id
     WHERE pa.invoice_id = $1 AND p.company_id = $2`,
    [invoiceId, companyId],
  );
  await client.query(
    `INSERT INTO owner_backup_snapshots (company_id, entity_type, entity_id, action, snapshot, created_by)
     VALUES ($1, 'invoice', $2, $3, $4, $5)`,
    [companyId, invoiceId, action, { invoice: inv.rows[0] || null, items: items.rows, payments: payments.rows }, createdBy],
  );
}

// ── GET /api/invoices/search-items ──────────────────────────────
export async function searchItems(req: Request, res: Response) {
  try {
    const { q, godown_id } = req.body;
    const companyId = req.user!.company_id;

    if (!q || String(q).length < 2) return res.json(success([]));

    let godownJoin = '';
    let godownSelect = ', 0 as available_stock';
    const params: any[] = [companyId, `%${q}%`];

    if (godown_id) {
      godownSelect = ', COALESCE(s.quantity, 0) as available_stock';
      godownJoin = `LEFT JOIN item_stock s ON i.id = s.item_id AND s.godown_id = $3`;
      params.push(godown_id);
    }

    const result = await query(
      `SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.selling_price as unit_price, i.gst_rate
       ${godownSelect}
       FROM items i
       ${godownJoin}
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.is_active = true
       AND (i.name ILIKE $2 OR i.sku ILIKE $2 OR i.barcode ILIKE $2)
       LIMIT 20`,
      params
    );

    res.json(success(result.rows));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/invoices/scan-barcode ──────────────────────────────
export async function scanBarcode(req: Request, res: Response) {
  try {
    const { barcode, godown_id } = req.body;
    const companyId = req.user!.company_id;

    if (!barcode) return res.status(400).json(error('Barcode required'));

    let godownJoin = '';
    let godownSelect = ', 0 as available_stock';
    const params: any[] = [companyId, barcode];

    if (godown_id) {
      godownSelect = ', COALESCE(s.quantity, 0) as available_stock';
      godownJoin = `LEFT JOIN item_stock s ON i.id = s.item_id AND s.godown_id = $3`;
      params.push(godown_id);
    }

    const result = await query(
      `SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.selling_price as unit_price, i.gst_rate
       ${godownSelect}
       FROM items i
       ${godownJoin}
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.is_active = true
       AND (i.barcode = $2 OR i.sku = $2)
       LIMIT 1`,
      params
    );

    if (result.rows.length === 0) {
      return res.json(success({ found: false }));
    }

    res.json(success({ found: true, item: result.rows[0] }));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/invoices ────────────────────────────────────────
export async function createInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!Array.isArray(d.items) || d.items.length === 0) {
      return res.status(400).json(error('At least one line item is required'));
    }
    if (d.invoice_type && !['sale', 'tax_invoice', 'non_gst'].includes(d.invoice_type)) {
      return res.status(400).json(error('Use the purchase module for supplier bills. This form only creates sales invoices.'));
    }
    const isGstInvoice = d.is_gst_invoice !== false && d.invoice_type !== 'non_gst';

    const mappedItems = d.items.map((it: any) => mapLineForGst({
      ...it,
      item_name: it.item_name || it.name,
      gst_rate: isGstInvoice ? it.gst_rate : 0,
      cess_rate: isGstInvoice ? it.cess_rate : 0,
    }));

    const result = await withTransaction(async (client) => {
      const rawType = d.invoice_type === 'non_gst' ? 'sale' : (d.invoice_type || 'tax_invoice');
      const isPurchase = rawType === 'purchase';
      const invoiceType = isPurchase ? 'purchase' : 'tax_invoice';

      const invoiceNumber = d.invoice_number || await generateInvoiceNumber(companyId, rawType, d.godown_id || req.user!.godown_id);

      let isInterstate = d.is_interstate;
      if (isInterstate === undefined && d.party_id) {
        const pRes = await client.query(
          'SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false',
          [d.party_id, companyId]
        );
        const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
        isInterstate = determineGSTType(cRes.rows[0]?.state_code, pRes.rows[0]?.billing_state_code) === 'inter';
      }
      isInterstate = Boolean(isInterstate);

      const gstType = isInterstate ? 'inter' : 'intra';
      const invDisc = Math.round(Number(d.discount_amount) || 0);
      const totalsInfo = calculateInvoiceTotals(
        mappedItems,
        gstType,
        invDisc > 0 ? 'flat' : 'none',
        invDisc,
      );

      const amountPaid = Math.round(Number(d.amount_paid) || 0);
      if (amountPaid < 0) throw new Error('Amount paid cannot be negative');
      if (amountPaid > totalsInfo.totalAmount) throw new Error('Amount paid cannot exceed invoice total');
      let paymentStatus = 'unpaid';
      if (amountPaid >= totalsInfo.totalAmount) paymentStatus = 'paid';
      else if (amountPaid > 0) paymentStatus = 'partial';

      const status = 'confirmed';

      let partySnap: { name?: string; gstin?: string; bill?: string; ship?: string } = {};
      if (d.party_id) {
        const pr = await client.query(
          `SELECT name, gstin, billing_address, shipping_address FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId]
        );
        if (pr.rows[0]) {
          partySnap = {
            name: pr.rows[0].name,
            gstin: pr.rows[0].gstin,
            bill: pr.rows[0].billing_address,
            ship: pr.rows[0].shipping_address,
          };
        }
      }

      const compEinv = await client.query(
        `SELECT einvoice_enabled, einvoice_turnover_above_5cr FROM companies WHERE id = $1`,
        [companyId]
      );
      const einvOn = compEinv.rows[0]?.einvoice_enabled && compEinv.rows[0]?.einvoice_turnover_above_5cr;
      const einvoiceStatus = einvOn ? 'pending' : 'not_applicable';

      const posRow = d.party_id
        ? await client.query(`SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [{}] };
      const placeOfSupply = (posRow.rows[0]?.billing_state_code || d.place_of_supply || '').toString().slice(0, 5) || null;

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const invRes = await client.query(
        `INSERT INTO invoices (
          company_id, invoice_number, invoice_type, party_id, godown_id,
          invoice_date, due_date, is_interstate, place_of_supply,
          party_name_snapshot, party_gstin_snapshot, billing_address_snapshot, shipping_address_snapshot,
          subtotal, discount_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, total_amount,
          paid_amount, payment_status, payment_mode, status, einvoice_status,
          notes, terms_and_conditions, created_by, pdf_template, document_theme,
          company_bank_account_id, bank_label_snapshot, bank_name_snapshot, bank_account_number_snapshot,
          bank_ifsc_snapshot, bank_branch_snapshot, upi_id_snapshot
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
          $33,$34,$35,$36,$37,$38,$39
        ) RETURNING *`,
        [
          companyId, invoiceNumber, invoiceType, d.party_id || null, d.godown_id || req.user!.godown_id,
          d.invoice_date || new Date().toISOString().split('T')[0],
          d.due_date || null,
          isInterstate,
          placeOfSupply,
          partySnap.name || null,
          partySnap.gstin || null,
          partySnap.bill || null,
          partySnap.ship || null,
          totalsInfo.subtotal,
          totalsInfo.totalDiscount,
          totalsInfo.totalTaxable,
          totalsInfo.totalCgst,
          totalsInfo.totalSgst,
          totalsInfo.totalIgst,
          totalsInfo.totalCess,
          totalsInfo.roundOff,
          totalsInfo.totalAmount,
          amountPaid,
          paymentStatus,
          d.payment_mode || null,
          status,
          einvoiceStatus,
          d.notes || null,
          d.terms_and_conditions || null,
          req.user!.id,
          ALLOWED_PDF_TEMPLATES.includes(String(d.pdf_template || '') as any) ? d.pdf_template : null,
          ALLOWED_DOCUMENT_THEMES.includes(String(d.document_theme || '') as any) ? d.document_theme : 'classic',
          bankSnap.company_bank_account_id,
          bankSnap.bank_label_snapshot,
          bankSnap.bank_name_snapshot,
          bankSnap.bank_account_number_snapshot,
          bankSnap.bank_ifsc_snapshot,
          bankSnap.bank_branch_snapshot,
          bankSnap.upi_id_snapshot,
        ]
      );

      const invoice = invRes.rows[0];
      const godownId = d.godown_id || req.user!.godown_id;

      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const lineGst = mapLineForGst({
          ...item,
          item_name: item.item_name || item.name,
          gst_rate: isGstInvoice ? item.gst_rate : 0,
          cess_rate: isGstInvoice ? item.cess_rate : 0,
        });
        const taxInfo = calculateInvoiceTotals([lineGst], gstType, 'none', 0);

        const gstRt = isGstInvoice ? Number(item.gst_rate) || 0 : 0;
        const half = gstRt / 2;

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, company_id, item_id, item_name, item_description, hsn_code, unit,
            quantity, unit_price, discount_amount, taxable_amount,
            gst_rate, cgst_rate, sgst_rate, igst_rate,
            cgst_amount, sgst_amount, igst_amount, cess_amount,
            total_amount, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            invoice.id, companyId, item.item_id || null,
            invoiceLineName(item),
            item.description || item.item_description || null,
            item.hsn_code || null,
            item.unit || 'PCS',
            item.quantity,
            Math.round(Number(item.unit_price) || 0),
            taxInfo.totalDiscountLineLevel,
            taxInfo.totalTaxable,
            gstRt,
            isInterstate ? 0 : half,
            isInterstate ? 0 : half,
            isInterstate ? gstRt : 0,
            taxInfo.totalCgst,
            taxInfo.totalSgst,
            taxInfo.totalIgst,
            taxInfo.totalCess,
            taxInfo.totalAmount,
            i + 1,
          ]
        );

        if (item.item_id && godownId && !isPurchase) {
          const itemRes = await client.query(
            `SELECT name, track_inventory
             FROM items
             WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [item.item_id, companyId]
          );
          if (!itemRes.rows.length) throw new Error(`Item not found for line ${i + 1}`);

          if (itemRes.rows[0].track_inventory) {
            const stockRes = await client.query(
              `SELECT quantity, reserved_quantity
               FROM item_stock
               WHERE item_id = $1 AND godown_id = $2 AND company_id = $3
               FOR UPDATE`,
              [item.item_id, godownId, companyId]
            );

            if (!stockRes.rows.length) {
              throw new Error(`No stock row found for "${itemRes.rows[0].name}" in the selected godown`);
            }

            const qty = Number(item.quantity) || 0;
            const available = Number(stockRes.rows[0].quantity || 0) - Number(stockRes.rows[0].reserved_quantity || 0);
            if (qty <= 0) throw new Error(`Invalid quantity for "${itemRes.rows[0].name}"`);
            if (available < qty) {
              throw new Error(`Insufficient stock for "${itemRes.rows[0].name}". Available: ${available}, requested: ${qty}`);
            }

            await client.query(
              `UPDATE item_stock
               SET quantity = quantity - $1::numeric
               WHERE item_id = $2 AND godown_id = $3 AND company_id = $4`,
              [qty, item.item_id, godownId, companyId]
            );

            const balRes = await client.query(
              'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3',
              [item.item_id, godownId, companyId]
            );

            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, created_by)
               VALUES ($1, $2, $3, 'sale', 'invoice', $4, $5, $6, $7)`,
              [companyId, item.item_id, godownId, invoice.id, -qty, balRes.rows[0]?.quantity || 0, req.user!.id]
            );
          }
        }
      }

      if (d.party_id) {
        const typeMult = isPurchase ? -1 : 1;
        await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3', [
          totalsInfo.totalAmount * typeMult, d.party_id, companyId,
        ]);
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'invoice', $5, $6, $7)`,
          [companyId, d.party_id, isPurchase ? 'credit' : 'debit', totalsInfo.totalAmount, invoice.id, invoice.invoice_number, req.user!.id]
        );

        if (amountPaid > 0) {
          await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3', [
            amountPaid * typeMult * -1, d.party_id, companyId,
          ]);
          await client.query(
            `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
             VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'payment', $5, $6, $7)`,
            [companyId, d.party_id, isPurchase ? 'debit' : 'credit', amountPaid, invoice.id, `Payment for ${invoice.invoice_number}`, req.user!.id]
          );
        }
      }

      if (amountPaid > 0) {
        const payRes = await client.query(
          `INSERT INTO payments (company_id, payment_type, payment_number, payment_date, party_id, amount, payment_mode, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            companyId,
            isPurchase ? 'outgoing' : 'incoming',
            `PAY-${Date.now()}`,
            invoice.invoice_date,
            d.party_id || null,
            amountPaid,
            d.payment_mode || 'cash',
            `Payment on ${invoice.invoice_number}`,
            req.user!.id,
          ]
        );
        await client.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount)
           VALUES ($1, $2, $3)`,
          [payRes.rows[0].id, invoice.id, amountPaid]
        );
      }

      return invoice;
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('createInvoice error:', err.message, err.detail, err.position);
    const msg = err?.message || 'Failed to create invoice';
    const status = /At least one|Use the purchase module|cannot|Insufficient|No stock row|not found|Invalid quantity/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

export async function listInvoices(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, status, party_id, invoice_type, overdue } = req.query;

    let where = `i.company_id = $1 AND i.is_deleted = false
      AND i.invoice_type IN ('sale', 'tax_invoice')`;
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (i.invoice_number ILIKE $${idx} OR p.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (status) {
      if (['paid', 'partial', 'unpaid'].includes(String(status))) {
        where += ` AND i.payment_status = $${idx}`;
      } else {
        where += ` AND i.status = $${idx}`;
      }
      params.push(status);
      idx++;
    }
    if (party_id) { where += ` AND i.party_id = $${idx}`; params.push(party_id); idx++; }
    if (invoice_type) {
      where += ` AND i.invoice_type = $${idx}`;
      params.push(invoice_type);
      idx++;
    }
    if (overdue === 'true') {
      where += ` AND i.status != 'cancelled' AND i.balance_due > 0 AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`;
    }

    const countRes = await query(`SELECT COUNT(*) FROM invoices i LEFT JOIN parties p ON i.party_id = p.id WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT i.*, p.name as party_name, p.phone as party_phone
       FROM invoices i LEFT JOIN parties p ON i.party_id = p.id
       WHERE ${where} ORDER BY i.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    const statsRes = await query(
      `SELECT
          COALESCE(SUM(CASE WHEN i.invoice_date = CURRENT_DATE THEN i.total_amount ELSE 0 END), 0)::bigint AS total_sales,
          COALESCE(SUM(CASE WHEN i.status != 'cancelled' THEN i.balance_due ELSE 0 END), 0)::bigint AS total_receivable,
          COUNT(*) FILTER (WHERE i.status != 'cancelled' AND i.payment_status = 'unpaid')::int AS unpaid_count,
          COUNT(*) FILTER (
            WHERE i.status != 'cancelled'
              AND i.balance_due > 0
              AND i.due_date IS NOT NULL
              AND i.due_date < CURRENT_DATE
          )::int AS overdue_count
       FROM invoices i
       WHERE i.company_id = $1
         AND i.is_deleted = false
         AND i.invoice_type IN ('sale', 'tax_invoice')`,
      [companyId]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit), statsRes.rows[0]));
  } catch (err: any) {
    const msg = err?.message || 'Failed to track payment';
    const status = /not found/i.test(msg) ? 404 : /Cannot|Invalid|exceeds/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

export async function getInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const invRes = await query(
      `SELECT i.*,
              i.paid_amount as amount_paid,
              p.name as party_name,
              p.phone as party_phone,
              COALESCE(i.party_gstin_snapshot, p.gstin) as party_gstin,
              COALESCE(i.billing_address_snapshot, p.billing_address) as party_billing_address,
              p.billing_city as party_city,
              p.billing_state as party_state,
              COALESCE(i.party_name_snapshot, p.name) as party_display_name,
              c.name as company_name,
              c.gstin as company_gstin,
              c.registered_address as company_address,
              COALESCE(i.bank_name_snapshot, c.bank_name) as bank_name,
              COALESCE(i.bank_account_number_snapshot, c.bank_account_number) as bank_account_number,
              COALESCE(i.bank_ifsc_snapshot, c.bank_ifsc) as bank_ifsc,
              COALESCE(i.bank_branch_snapshot, c.bank_branch) as bank_branch,
              COALESCE(i.upi_id_snapshot, c.upi_id) as upi_id,
              c.einvoice_enabled, c.einvoice_turnover_above_5cr
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id AND p.is_deleted = false
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [id, req.user!.company_id]
    );
    if (!invRes.rows.length) return res.status(404).json(error('Not found'));

    const row = invRes.rows[0];
    const itemsRes = await query(
      `SELECT ii.*, i.sku as item_sku, u.abbreviation as unit_abbr
       FROM invoice_items ii
       LEFT JOIN items i ON i.id = ii.item_id
       LEFT JOIN item_units u ON u.id = i.unit_id
       WHERE ii.invoice_id = $1 AND ii.company_id = $2
       ORDER BY ii.sort_order, ii.id`,
      [id, req.user!.company_id]
    );

    const payRes = await query(
      `SELECT p.* FROM payments p
       INNER JOIN payment_allocations pa ON pa.payment_id = p.id
       WHERE pa.invoice_id = $1 AND p.company_id = $2 AND p.is_deleted = false
       ORDER BY p.payment_date DESC`,
      [id, req.user!.company_id]
    );

    res.json(success({
      ...row,
      items: itemsRes.rows,
      payments: payRes.rows,
    }));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

/** PATCH /api/invoices/:id — unpaid sales invoices only; reverses stock & party effect then re-applies. */
export async function updateInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!Array.isArray(d.items) || d.items.length === 0) {
      return res.status(400).json(error('At least one line item is required'));
    }

    const result = await withTransaction(async (client) => {
      const invRes = await client.query(
        `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!invRes.rows.length) throw new Error('Invoice not found');
      const oldInv = invRes.rows[0];

      if (oldInv.status === 'cancelled') throw new Error('Cannot edit a cancelled invoice');
      if (oldInv.irn) throw new Error('Cannot edit an invoice with an e-invoice IRN. Cancel the IRN first.');
      if (oldInv.invoice_type === 'purchase') throw new Error('Purchase bills are edited under Purchases, not here.');
      if (!['sale', 'tax_invoice'].includes(String(oldInv.invoice_type || ''))) {
        throw new Error('This invoice type cannot be edited from the sales form.');
      }

      const allocRes = await client.query(
        `SELECT 1 FROM payment_allocations pa
         INNER JOIN payments p ON p.id = pa.payment_id
         WHERE pa.invoice_id = $1 AND p.company_id = $2 AND p.is_deleted = false
         LIMIT 1`,
        [id, companyId],
      );
      if (allocRes.rows.length) throw new Error('Cannot edit an invoice that has payments recorded');
      if (Number(oldInv.paid_amount || 0) > 0) throw new Error('Cannot edit an invoice with an amount paid');

      await backupInvoiceSnapshot(client, companyId, id, 'before_update_invoice', req.user!.id);

      const isGstInvoice = d.is_gst_invoice !== false && d.invoice_type !== 'non_gst';
      const mappedItems = d.items.map((it: any) =>
        mapLineForGst({
          ...it,
          item_name: it.item_name || it.name,
          gst_rate: isGstInvoice ? it.gst_rate : 0,
          cess_rate: isGstInvoice ? it.cess_rate : 0,
        }),
      );

      let isInterstate = d.is_interstate;
      if (isInterstate === undefined && d.party_id) {
        const pRes = await client.query(
          'SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false',
          [d.party_id, companyId],
        );
        const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
        isInterstate = determineGSTType(cRes.rows[0]?.state_code, pRes.rows[0]?.billing_state_code) === 'inter';
      }
      isInterstate = Boolean(isInterstate);

      const gstType = isInterstate ? 'inter' : 'intra';
      const invDisc = Math.round(Number(d.discount_amount) || 0);
      const totalsInfo = calculateInvoiceTotals(mappedItems, gstType, invDisc > 0 ? 'flat' : 'none', invDisc);

      const itemsRes = await client.query(
        `SELECT ii.*, it.name AS item_master_name, it.track_inventory
         FROM invoice_items ii
         LEFT JOIN items it ON it.id = ii.item_id
         WHERE ii.invoice_id = $1 AND ii.company_id = $2
         ORDER BY ii.sort_order, ii.id`,
        [id, companyId],
      );

      const oldGodown = oldInv.godown_id;
      if (oldGodown && oldInv.invoice_type !== 'purchase') {
        for (const row of itemsRes.rows) {
          if (!row.item_id || !row.track_inventory) continue;
          const qty = Number(row.quantity) || 0;
          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1, $2, $3, $4, 0)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET
               quantity = item_stock.quantity + EXCLUDED.quantity`,
            [companyId, row.item_id, oldGodown, qty],
          );
          const balRes = await client.query(
            `SELECT quantity FROM item_stock WHERE company_id = $1 AND item_id = $2 AND godown_id = $3`,
            [companyId, row.item_id, oldGodown],
          );
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1, $2, $3, 'sale_cancel', 'invoice', $4, $5, $6, $7, $8)`,
            [
              companyId,
              row.item_id,
              oldGodown,
              id,
              qty,
              balRes.rows[0]?.quantity || qty,
              `Edit invoice ${oldInv.invoice_number}: restore stock`,
              req.user!.id,
            ],
          );
        }
      }

      const oldTotal = Number(oldInv.total_amount || 0);
      const oldPartyId = oldInv.party_id;
      await client.query(
        `DELETE FROM party_ledger WHERE company_id = $1 AND reference_id = $2 AND reference_type = 'invoice'`,
        [companyId, id],
      );
      if (oldPartyId && oldTotal !== 0) {
        await client.query(`UPDATE parties SET balance = balance - $1 WHERE id = $2 AND company_id = $3`, [
          oldTotal,
          oldPartyId,
          companyId,
        ]);
      }

      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1 AND company_id = $2`, [id, companyId]);

      let partySnap: { name?: string; gstin?: string; bill?: string; ship?: string } = {};
      if (d.party_id) {
        const pr = await client.query(
          `SELECT name, gstin, billing_address, shipping_address FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId],
        );
        if (pr.rows[0]) {
          partySnap = {
            name: pr.rows[0].name,
            gstin: pr.rows[0].gstin,
            bill: pr.rows[0].billing_address,
            ship: pr.rows[0].shipping_address,
          };
        }
      }

      const posRow = d.party_id
        ? await client.query(`SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [{}] };
      const placeOfSupply = (posRow.rows[0]?.billing_state_code || d.place_of_supply || '').toString().slice(0, 5) || null;

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const pdfTpl = ALLOWED_PDF_TEMPLATES.includes(String(d.pdf_template || '') as any) ? d.pdf_template : oldInv.pdf_template;
      const docTheme = ALLOWED_DOCUMENT_THEMES.includes(String(d.document_theme || '') as any)
        ? d.document_theme
        : oldInv.document_theme || 'classic';

      await client.query(
        `UPDATE invoices SET
          party_id = $1, godown_id = $2, invoice_date = $3, due_date = $4, is_interstate = $5, place_of_supply = $6,
          party_name_snapshot = $7, party_gstin_snapshot = $8, billing_address_snapshot = $9, shipping_address_snapshot = $10,
          subtotal = $11, discount_amount = $12, taxable_amount = $13,
          cgst_amount = $14, sgst_amount = $15, igst_amount = $16, cess_amount = $17, round_off = $18, total_amount = $19,
          payment_status = 'unpaid', notes = $20, pdf_template = $21, document_theme = $22,
          is_gst_invoice = $23,
          company_bank_account_id = $24, bank_label_snapshot = $25, bank_name_snapshot = $26,
          bank_account_number_snapshot = $27, bank_ifsc_snapshot = $28, bank_branch_snapshot = $29, upi_id_snapshot = $30,
          updated_at = NOW()
        WHERE id = $31 AND company_id = $32`,
        [
          d.party_id || null,
          d.godown_id || req.user!.godown_id || null,
          d.invoice_date || oldInv.invoice_date,
          d.due_date ?? oldInv.due_date,
          isInterstate,
          placeOfSupply,
          partySnap.name || null,
          partySnap.gstin || null,
          partySnap.bill || null,
          partySnap.ship || null,
          totalsInfo.subtotal,
          totalsInfo.totalDiscount,
          totalsInfo.totalTaxable,
          totalsInfo.totalCgst,
          totalsInfo.totalSgst,
          totalsInfo.totalIgst,
          totalsInfo.totalCess,
          totalsInfo.roundOff,
          totalsInfo.totalAmount,
          d.notes ?? oldInv.notes,
          pdfTpl,
          docTheme,
          isGstInvoice,
          bankSnap.company_bank_account_id,
          bankSnap.bank_label_snapshot,
          bankSnap.bank_name_snapshot,
          bankSnap.bank_account_number_snapshot,
          bankSnap.bank_ifsc_snapshot,
          bankSnap.bank_branch_snapshot,
          bankSnap.upi_id_snapshot,
          id,
          companyId,
        ],
      );

      const godownId = d.godown_id || req.user!.godown_id;
      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const lineGst = mapLineForGst({
          ...item,
          item_name: item.item_name || item.name,
          gst_rate: isGstInvoice ? item.gst_rate : 0,
          cess_rate: isGstInvoice ? item.cess_rate : 0,
        });
        const taxInfo = calculateInvoiceTotals([lineGst], gstType, 'none', 0);
        const gstRt = isGstInvoice ? Number(item.gst_rate) || 0 : 0;
        const half = gstRt / 2;

        await client.query(
          `INSERT INTO invoice_items (
            invoice_id, company_id, item_id, item_name, item_description, hsn_code, unit,
            quantity, unit_price, discount_amount, taxable_amount,
            gst_rate, cgst_rate, sgst_rate, igst_rate,
            cgst_amount, sgst_amount, igst_amount, cess_amount,
            total_amount, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            id,
            companyId,
            item.item_id || null,
            invoiceLineName(item),
            item.description || item.item_description || null,
            item.hsn_code || null,
            item.unit || 'PCS',
            item.quantity,
            Math.round(Number(item.unit_price) || 0),
            taxInfo.totalDiscountLineLevel,
            taxInfo.totalTaxable,
            gstRt,
            isInterstate ? 0 : half,
            isInterstate ? 0 : half,
            isInterstate ? gstRt : 0,
            taxInfo.totalCgst,
            taxInfo.totalSgst,
            taxInfo.totalIgst,
            taxInfo.totalCess,
            taxInfo.totalAmount,
            i + 1,
          ],
        );

        if (item.item_id && godownId) {
          const itemRes = await client.query(
            `SELECT name, track_inventory FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [item.item_id, companyId],
          );
          if (!itemRes.rows.length) throw new Error(`Item not found for line ${i + 1}`);
          if (itemRes.rows[0].track_inventory) {
            const stockRes = await client.query(
              `SELECT quantity, reserved_quantity FROM item_stock
               WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE`,
              [item.item_id, godownId, companyId],
            );
            if (!stockRes.rows.length) throw new Error(`No stock row found for "${itemRes.rows[0].name}" in the selected godown`);
            const qty = Number(item.quantity) || 0;
            const available = Number(stockRes.rows[0].quantity || 0) - Number(stockRes.rows[0].reserved_quantity || 0);
            if (qty <= 0) throw new Error(`Invalid quantity for "${itemRes.rows[0].name}"`);
            if (available < qty) {
              throw new Error(`Insufficient stock for "${itemRes.rows[0].name}". Available: ${available}, requested: ${qty}`);
            }
            await client.query(
              `UPDATE item_stock SET quantity = quantity - $1::numeric WHERE item_id = $2 AND godown_id = $3 AND company_id = $4`,
              [qty, item.item_id, godownId, companyId],
            );
            const balRes = await client.query(
              'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3',
              [item.item_id, godownId, companyId],
            );
            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, created_by)
               VALUES ($1, $2, $3, 'sale', 'invoice', $4, $5, $6, $7)`,
              [companyId, item.item_id, godownId, id, -qty, balRes.rows[0]?.quantity || 0, req.user!.id],
            );
          }
        }
      }

      if (d.party_id) {
        await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2 AND company_id = $3', [
          totalsInfo.totalAmount,
          d.party_id,
          companyId,
        ]);
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, $3, $4, (SELECT balance FROM parties WHERE id = $2), 'invoice', $5, $6, $7)`,
          [companyId, d.party_id, 'debit', totalsInfo.totalAmount, id, oldInv.invoice_number, req.user!.id],
        );
      }

      const fresh = await client.query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2`, [id, companyId]);
      return fresh.rows[0];
    });

    await logAction(req.user!.id, companyId, 'update', 'invoice', id, { invoice_number: result.invoice_number }, { total: result.total_amount }, req.ip, req.get('User-Agent'));
    res.json(success(result));
  } catch (err: any) {
    console.error('updateInvoice error:', err.message, err.detail, err.position);
    const msg = err?.message || 'Failed to update invoice';
    const status = /not found|Cannot edit|Insufficient|No stock row|Invalid quantity|At least one/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

export async function cancelInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const result = await withTransaction(async (client) => {
      const invRes = await client.query(
        `SELECT *
         FROM invoices
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR UPDATE`,
        [id, companyId]
      );
      if (!invRes.rows.length) throw new Error('Invoice not found');
      const inv = invRes.rows[0];

      if (inv.status === 'cancelled') throw new Error('Invoice is already cancelled');
      if (Number(inv.paid_amount || 0) > 0) throw new Error('Cannot cancel an invoice that has payments recorded');
      if (inv.irn) throw new Error('Cancel e-invoice IRN before cancelling this invoice');

      const itemsRes = await client.query(
        `SELECT ii.*, it.name AS item_master_name, it.track_inventory
         FROM invoice_items ii
         LEFT JOIN items it ON it.id = ii.item_id
         WHERE ii.invoice_id = $1 AND ii.company_id = $2
         ORDER BY ii.sort_order, ii.id`,
        [id, companyId]
      );

      await backupInvoiceSnapshot(client, companyId, id, 'cancel_invoice', req.user!.id);

      if (inv.invoice_type !== 'purchase' && inv.godown_id) {
        for (const row of itemsRes.rows) {
          if (!row.item_id || !row.track_inventory) continue;
          const qty = Number(row.quantity) || 0;
          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1, $2, $3, $4, 0)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET
               quantity = item_stock.quantity + EXCLUDED.quantity`,
            [companyId, row.item_id, inv.godown_id, qty]
          );
          const balRes = await client.query(
            `SELECT quantity
             FROM item_stock
             WHERE company_id = $1 AND item_id = $2 AND godown_id = $3`,
            [companyId, row.item_id, inv.godown_id]
          );
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1, $2, $3, 'sale_cancel', 'invoice', $4, $5, $6, $7, $8)`,
            [companyId, row.item_id, inv.godown_id, inv.id, qty, balRes.rows[0]?.quantity || qty, `Cancellation of ${inv.invoice_number}`, req.user!.id]
          );
        }
      }

      if (inv.party_id) {
        const partyDelta = inv.invoice_type === 'purchase' ? Number(inv.total_amount || 0) : -Number(inv.total_amount || 0);
        await client.query(
          `UPDATE parties
           SET balance = balance + $1
           WHERE id = $2 AND company_id = $3`,
          [partyDelta, inv.party_id, companyId]
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES (
             $1, $2, $3, $4,
             (SELECT balance FROM parties WHERE id = $2),
             'invoice_cancel', $5, $6, $7
           )`,
          [
            companyId,
            inv.party_id,
            inv.invoice_type === 'purchase' ? 'debit' : 'credit',
            Number(inv.total_amount || 0),
            inv.id,
            `Cancelled ${inv.invoice_number}`,
            req.user!.id,
          ]
        );
      }

      await client.query(
        `UPDATE invoices
         SET status = 'cancelled',
             is_deleted = true,
             payment_status = CASE WHEN paid_amount > 0 THEN payment_status ELSE 'unpaid' END,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );

      return inv;
    });

    await logAction(req.user!.id, companyId, 'cancel', 'invoice', id, { invoice_number: result.invoice_number }, { status: 'cancelled' }, req.ip, req.get('User-Agent'));
    res.json(success({ message: 'Invoice cancelled successfully' }));
  } catch (err: any) {
    const msg = err?.message || 'Failed to cancel invoice';
    const status = /not found/i.test(msg) ? 404 : /already|Cannot|Cancel e-invoice/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
  }
}

export async function deleteInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const invRes = await query(
      `SELECT id, status, paid_amount, irn, invoice_number FROM invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invRes.rows[0];
    if (inv.irn) {
      return res.status(400).json(error('This invoice has an active IRN. Cancel e-invoice before deleting.'));
    }
    if (Number(inv.paid_amount || 0) > 0) {
      return res.status(400).json(error('Cannot delete an invoice that has payments recorded.'));
    }
    if (inv.status !== 'draft' && inv.status !== 'cancelled') {
      return res.status(400).json(error('Only draft or already-cancelled invoices can be deleted. Cancel the invoice first.'));
    }
    await withTransaction(async (client) => {
      await backupInvoiceSnapshot(client, companyId, id, 'delete_invoice', req.user!.id);
      await client.query(
        `UPDATE invoices SET is_deleted = true, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
        [id, companyId],
      );
    });
    await logAction(
      req.user!.id,
      companyId,
      'delete',
      'invoice',
      id,
      { invoice_number: inv.invoice_number },
      null,
      req.ip,
      req.get('User-Agent'),
    );
    res.json(success({ message: 'Invoice removed from active records' }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function getInvoicePDF(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const invRes = await query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [id, req.user!.company_id]);
    if (!invRes.rows.length) return res.status(404).send('Invoice not found');

    const companyRes = await query('SELECT * FROM companies WHERE id = $1', [req.user!.company_id]);
    const bankRes = await query(
      `SELECT * FROM company_bank_accounts
       WHERE company_id = $1 AND is_deleted = false AND is_active = true
       ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      [req.user!.company_id],
    );
    const companyForPdf = await resolveCompanyRowForInvoicePdf(
      query as unknown as Queryable,
      req.user!.company_id,
      companyRes.rows[0],
      invRes.rows[0],
      bankRes.rows[0] || null,
    );
    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
      [id, req.user!.company_id]
    );
    const partyRes = invRes.rows[0].party_id
      ? await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [invRes.rows[0].party_id, req.user!.company_id])
      : { rows: [null] };

    const tpl = String(req.query.template || '');
    const templateOverride = (ALLOWED_PDF_TEMPLATES as readonly string[]).includes(tpl) ? tpl : invRes.rows[0].pdf_template || undefined;
    if (templateOverride) {
      invRes.rows[0].pdf_template = templateOverride;
    }
    if ((ALLOWED_DOCUMENT_THEMES as readonly string[]).includes(String(req.query.theme || ''))) {
      invRes.rows[0].document_theme = String(req.query.theme);
    }

    const pdfBuffer = await generateInvoicePDF(invRes.rows[0], companyForPdf, partyRes.rows[0], itemsRes.rows, {
      ...(templateOverride ? { templateOverride } : {}),
    });

    const inline = String(req.query.inline || '') === '1';
    const fn = `${invRes.rows[0].invoice_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename=${fn}`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

/** POST /api/invoices/preview-pdf — same line/tax rules as create, no DB write; for live template preview while drafting. */
export async function previewInvoicePdf(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body || {};
    const templateRaw = String(d.template || 'standard');
    const template = ALLOWED_PDF_TEMPLATES.includes(templateRaw as any) ? templateRaw : 'standard';
    const theme = ALLOWED_DOCUMENT_THEMES.includes(String(d.theme || '') as any) ? String(d.theme) : 'classic';

    if (!Array.isArray(d.items) || d.items.length === 0) {
      return res.status(400).json(error('At least one line item is required'));
    }

    const companyRes = await query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
    if (!companyRes.rows.length) return res.status(400).json(error('Company not found'));
    const bankRes = await query(
      `SELECT * FROM company_bank_accounts
       WHERE company_id = $1 AND is_deleted = false AND is_active = true
       ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      [companyId],
    );
    let company = bankRes.rows[0]
      ? {
          ...companyRes.rows[0],
          bank_name: bankRes.rows[0].bank_name,
          bank_account_number: bankRes.rows[0].account_number,
          bank_ifsc: bankRes.rows[0].ifsc,
          bank_branch: bankRes.rows[0].branch,
          upi_id: bankRes.rows[0].upi_id || companyRes.rows[0].upi_id,
        }
      : companyRes.rows[0];

    const pickId = d.company_bank_account_id;
    if (pickId) {
      const pickRes = await query(
        `SELECT * FROM company_bank_accounts
         WHERE id = $1 AND company_id = $2 AND is_deleted = false AND is_active = true`,
        [pickId, companyId],
      );
      const b = pickRes.rows[0];
      if (b) {
        company = {
          ...companyRes.rows[0],
          bank_name: b.bank_name,
          bank_account_number: b.account_number,
          bank_ifsc: b.ifsc,
          bank_branch: b.branch,
          upi_id: b.upi_id || companyRes.rows[0].upi_id,
        };
      }
    }

    let party: any = null;
    if (d.party_id) {
      const pRes = await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [d.party_id, companyId]);
      party = pRes.rows[0] || null;
    }

    let isInterstate = Boolean(d.is_interstate);
    if (d.is_interstate === undefined && d.party_id) {
      const pRes = await query(
        'SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false',
        [d.party_id, companyId],
      );
      const cRes = await query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      isInterstate = determineGSTType(cRes.rows[0]?.state_code, pRes.rows[0]?.billing_state_code) === 'inter';
    }
    const gstType = isInterstate ? 'inter' : 'intra';

    const isGstInvoice = d.is_gst_invoice !== false && d.invoice_type !== 'non_gst';
    const mappedItems = d.items.map((it: any) => mapLineForGst({
      ...it,
      item_name: it.item_name || it.name,
      gst_rate: isGstInvoice ? it.gst_rate : 0,
      cess_rate: isGstInvoice ? it.cess_rate : 0,
    }));
    const invDisc = Math.round(Number(d.discount_amount) || 0);
    const totals = calculateInvoiceTotals(mappedItems, gstType, invDisc > 0 ? 'flat' : 'none', invDisc);

    const posRow = d.party_id
      ? await query(`SELECT billing_state_code FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
      : { rows: [{}] };
    const placeOfSupply = (posRow.rows[0]?.billing_state_code || d.place_of_supply || '').toString().slice(0, 5) || null;

    const partySnap = party
      ? { name: party.name as string, gstin: party.gstin as string | null, bill: party.billing_address as string | null }
      : { name: String(d.party_name || 'Walk-in Customer'), gstin: null as string | null, bill: null as string | null };

    const pdfRows: any[] = [];
    for (let i = 0; i < d.items.length; i++) {
      const item = d.items[i];
      const lineGst = mappedItems[i];
      const taxInfo = calculateInvoiceTotals([lineGst], gstType, 'none', 0);
      pdfRows.push({
        item_name: invoiceLineName(item),
        item_description: item.item_description || item.description || null,
        hsn_code: item.hsn_code || null,
        quantity: lineGst.quantity,
        unit_price: lineGst.unit_price,
        discount_amount: taxInfo.totalDiscountLineLevel,
        taxable_amount: taxInfo.totalTaxable,
        gst_rate: lineGst.gst_rate,
        cgst_amount: taxInfo.totalCgst,
        sgst_amount: taxInfo.totalSgst,
        igst_amount: taxInfo.totalIgst,
        total_amount: taxInfo.totalAmount,
      });
    }

    const invoice = {
      invoice_number: 'PREVIEW',
      invoice_date: d.invoice_date || new Date().toISOString().split('T')[0],
      due_date: d.due_date || null,
      party_name_snapshot: partySnap.name,
      party_gstin_snapshot: partySnap.gstin,
      billing_address_snapshot: partySnap.bill,
      place_of_supply: placeOfSupply,
      is_interstate: isInterstate,
      subtotal: totals.subtotal,
      discount_amount: totals.totalDiscount,
      taxable_amount: totals.totalTaxable,
      cgst_amount: totals.totalCgst,
      sgst_amount: totals.totalSgst,
      igst_amount: totals.totalIgst,
      round_off: totals.roundOff,
      total_amount: totals.totalAmount,
      irn: null,
      qr_code_url: null,
      pdf_template: template,
      document_theme: theme,
    };

    const pdfBuffer = await generateInvoicePDF(invoice, company, party, pdfRows, { templateOverride: template });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=invoice-preview.pdf');
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function sendWhatsApp(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const compRes = await query(
      `SELECT name, phone FROM companies WHERE id = $1 AND is_deleted = false`,
      [companyId],
    );
    if (!compRes.rows.length) return res.status(400).json(error('Company not found'));
    const company = compRes.rows[0];

    const invRes = await query(
      `SELECT i.*, p.name AS party_name, p.phone AS party_phone
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [id, companyId],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    const row = invRes.rows[0];

    const phone = String(req.body?.phone || row.party_phone || '').replace(/\s+/g, '');
    if (!phone) {
      return res.status(400).json(error('Enter a mobile number to share this invoice.'));
    }

    const partyName = row.party_name_snapshot || row.party_name || 'Customer';
    const invDate =
      row.invoice_date instanceof Date
        ? row.invoice_date.toISOString().slice(0, 10)
        : String(row.invoice_date).slice(0, 10);
    const amountStr = (Number(row.total_amount || 0) / 100).toFixed(2);
    const link = `${env.FRONTEND_URL.replace(/\/$/, '')}/sales/${id}`;

    const result = await sendWhatsAppInvoiceLink(
      phone,
      {
        party_name: partyName,
        company_name: String(company.name || 'Our business'),
        invoice_number: String(row.invoice_number),
        date: invDate,
        amount: amountStr,
        link,
        phone: String(company.phone || ''),
      },
      companyId,
    );

    await logAction(
      req.user!.id,
      companyId,
      'whatsapp_send',
      'invoice',
      id,
      { invoice_number: row.invoice_number },
      result,
      req.ip,
      req.get('User-Agent'),
    );

    res.json(
      success({
        ...result,
        link,
        note:
          result.status === 'bypassed_no_credentials'
            ? 'Twilio is not configured; message was logged only. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to deliver WhatsApp.'
            : undefined,
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function generateEinvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const comp = await query(
      `SELECT * FROM companies WHERE id = $1 AND is_deleted = false`,
      [companyId]
    );
    if (!comp.rows.length) return res.status(400).json(error('Company not found'));
    const company = comp.rows[0];
    if (!company.einvoice_enabled) {
      return res.status(400).json(error('Enable e-invoice in company settings first'));
    }

    const invRes = await query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [id, companyId]);
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    const inv = invRes.rows[0];
    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order`,
      [id, companyId]
    );

    let party: any = {
      gstin: inv.party_gstin_snapshot,
      name: inv.party_name_snapshot || 'Customer',
      billing_address: inv.billing_address_snapshot,
      billing_city: null,
      billing_state: null,
      billing_pincode: null,
      billing_state_code: inv.place_of_supply,
    };
    if (inv.party_id) {
      const pRes = await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [inv.party_id, companyId]);
      if (pRes.rows[0]) {
        party = {
          gstin: inv.party_gstin_snapshot || pRes.rows[0].gstin,
          name: inv.party_name_snapshot || pRes.rows[0].name,
          billing_address: inv.billing_address_snapshot || pRes.rows[0].billing_address,
          billing_city: pRes.rows[0].billing_city,
          billing_state: pRes.rows[0].billing_state || pRes.rows[0].state,
          billing_pincode: pRes.rows[0].billing_pincode,
          billing_state_code: pRes.rows[0].billing_state_code || inv.place_of_supply,
        };
      }
    }

    const payload = buildEinvoicePayload(inv, company, party, itemsRes.rows as EinvoiceItemRow[]);
    const irnData = await generateIRN(payload, company);
    const qrUrl = await generateEinvoiceQR(irnData.irn, inv, env.EINVOICE_MODE, payload, irnData.signed_qr_code);

    await query(
      `UPDATE invoices SET irn = $1, ack_number = $2, ack_date = $3, einvoice_status = $4, qr_code_url = $5, updated_at = now()
       WHERE id = $6 AND company_id = $7`,
      [irnData.irn, irnData.ack_number, irnData.ack_date, 'generated', qrUrl, id, companyId]
    );

    res.json(success({ irn: irnData.irn, ack_number: irnData.ack_number, ack_date: irnData.ack_date, qr_code_url: qrUrl }));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(externalTaxErrorStatus(err.message)).json(error(err.message));
  }
}

export async function cancelEinvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { reason_code, reason_description } = req.body;
    const companyId = req.user!.company_id;

    const invRes = await query(`SELECT irn, einvoice_status FROM invoices WHERE id = $1 AND company_id = $2`, [id, companyId]);
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invRes.rows[0];
    if (!inv.irn) return res.status(400).json(error('No IRN to cancel'));

    const comp = await query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
    await cancelIRN(inv.irn, Number(reason_code) || 4, String(reason_description || 'Other'), comp.rows[0]);

    await query(
      `UPDATE invoices SET einvoice_status = 'cancelled', updated_at = now() WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    res.json(success({ cancelled: true }));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function generateEwayBill(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const {
      transporter_id,
      transporter_name,
      transport_mode,
      distance_km,
      trans_doc_no,
      trans_doc_dt,
      vehicle_no,
      vehicle_type,
    } = req.body || {};

    if (!transporter_id || String(transporter_id).trim().length !== 15) {
      return res.status(400).json(error('transporter_id must be a 15-character transporter GSTIN / TRANSIN'));
    }
    const cleanVehicleNo = String(vehicle_no || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleanVehicleNo || cleanVehicleNo.length < 4) {
      return res.status(400).json(error('vehicle_no is required (minimum 4 characters)'));
    }

    const invRes = await query(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invRes.rows[0];
    if (!inv.irn) return res.status(400).json(error('Generate IRN before generating E-Way Bill'));
    if (inv.einvoice_status !== 'generated') return res.status(400).json(error('E-invoice must be in generated state'));
    if (inv.eway_bill_no && inv.eway_bill_status !== 'cancelled') {
      return res.status(400).json(error('E-Way Bill already generated for this invoice'));
    }

    const compRes = await query(`SELECT * FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]);
    if (!compRes.rows.length) return res.status(400).json(error('Company not found'));
    const company = compRes.rows[0];
    const sellerGstin = String(company.gstin || '').trim().toUpperCase();
    if (sellerGstin.length !== 15) return res.status(400).json(error('Company GSTIN is required to generate E-Way Bill'));

    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
      [id, companyId],
    );
    if (!itemsRes.rows.length) return res.status(400).json(error('Invoice must have at least one item to generate E-Way Bill'));

    let party: any = {
      gstin: inv.party_gstin_snapshot,
      name: inv.party_name_snapshot || 'Customer',
      billing_address: inv.billing_address_snapshot,
      billing_city: null,
      billing_state: null,
      billing_pincode: null,
    };
    if (inv.party_id) {
      const pRes = await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [inv.party_id, companyId]);
      if (pRes.rows[0]) {
        party = {
          gstin: inv.party_gstin_snapshot || pRes.rows[0].gstin,
          name: inv.party_name_snapshot || pRes.rows[0].name,
          billing_address: inv.billing_address_snapshot || pRes.rows[0].billing_address || pRes.rows[0].address,
          billing_city: pRes.rows[0].billing_city || pRes.rows[0].city,
          billing_state: pRes.rows[0].billing_state || pRes.rows[0].state,
          billing_pincode: pRes.rows[0].billing_pincode || pRes.rows[0].pincode,
        };
      }
    }

    const companyAddress = [
      company.registered_address,
      company.city,
      company.state,
      company.pincode,
    ].filter(Boolean).join(', ');
    const partyAddress = [
      party.billing_address,
      party.billing_city,
      party.billing_state,
      party.billing_pincode,
    ].filter(Boolean).join(', ');

    const out = await generateEwayBillViaService({
      sellerGstin,
      irn: inv.irn,
      transporter_id: String(transporter_id).trim(),
      transporter_name: transporter_name ? String(transporter_name) : undefined,
      transport_mode: transport_mode ? String(transport_mode) : undefined,
      distance_km: Number(distance_km || 0),
      trans_doc_no: trans_doc_no ? String(trans_doc_no) : undefined,
      trans_doc_dt: trans_doc_dt ? String(trans_doc_dt) : undefined,
      vehicle_no: cleanVehicleNo,
      vehicle_type: String(vehicle_type || 'R').toUpperCase() === 'O' ? 'O' : 'R',
      fullInvoice: {
        invoice: {
          ...inv,
          company_gstin: sellerGstin,
          company_name: company.legal_name || company.name,
          company_address: companyAddress,
          customer_gstin: party.gstin,
          customer_name: party.name,
          customer_address: partyAddress,
        },
        items: itemsRes.rows,
      },
    });

    await query(
      `UPDATE invoices
       SET eway_bill_no = $1,
           eway_bill_date = $2,
           eway_bill_valid_upto = $3,
           eway_bill_status = 'generated',
           updated_at = now()
       WHERE id = $4 AND company_id = $5`,
      [out.ewb_no, out.ewb_date, out.valid_upto, id, companyId],
    );

    res.json(success(out));
  } catch (err: any) {
    console.error('generateEwayBill error:', err.message, err.detail, err.position);
    res.status(externalTaxErrorStatus(err.message)).json(error(err.message));
  }
}

export async function cancelEwayBill(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const reason_code = Number(req.body?.reason_code) || 4;
    const reason_description = String(req.body?.reason_description || 'Cancelled');

    const invRes = await query(
      `SELECT eway_bill_no, eway_bill_status FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));
    const inv = invRes.rows[0];
    if (!inv.eway_bill_no) return res.status(400).json(error('No E-Way Bill to cancel'));
    if (inv.eway_bill_status === 'cancelled') return res.status(400).json(error('E-Way Bill already cancelled'));

    const compRes = await query(`SELECT gstin FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]);
    if (!compRes.rows.length) return res.status(400).json(error('Company not found'));
    const sellerGstin = String(compRes.rows[0].gstin || '').trim().toUpperCase();
    if (sellerGstin.length !== 15) return res.status(400).json(error('Company GSTIN is required to cancel E-Way Bill'));

    const out = await cancelEwayBillViaService({
      sellerGstin,
      ewb_no: String(inv.eway_bill_no),
      reason_code,
      reason_description,
    });

    await query(
      `UPDATE invoices
       SET eway_bill_status = 'cancelled',
           updated_at = now()
       WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );

    res.json(success(out));
  } catch (err: any) {
    console.error('cancelEwayBill error:', err.message, err.detail, err.position);
    res.status(externalTaxErrorStatus(err.message)).json(error(err.message));
  }
}

export async function getEinvoicePdf(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const invRes = await query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [id, companyId]);
    if (!invRes.rows.length) return res.status(404).send('Not found');
    const companyRes = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    const itemsRes = await query(`SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2`, [id, companyId]);
    const partyRes = invRes.rows[0].party_id
      ? await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [invRes.rows[0].party_id, companyId])
      : { rows: [null] };

    const buf = await generateEinvoicePdf(invRes.rows[0], companyRes.rows[0], partyRes.rows[0], itemsRes.rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=einvoice-${invRes.rows[0].invoice_number}.pdf`);
    res.send(buf);
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

export async function recordPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { amount, payment_mode, reference_number } = req.body;
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return res.status(400).json(error('Invalid amount'));
    const companyId = req.user!.company_id;

    const result = await withTransaction(async (client) => {
      const invRes = await client.query(
        `SELECT id, party_id, invoice_number, total_amount, paid_amount, status
         FROM invoices
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR UPDATE`,
        [id, companyId]
      );
      if (!invRes.rows.length) throw new Error('Invoice not found');
      const inv = invRes.rows[0];
      if (inv.status === 'cancelled') throw new Error('Cannot record payment for a cancelled invoice');

      const currentPaid = Number(inv.paid_amount || 0);
      const total = Number(inv.total_amount || 0);
      const remaining = total - currentPaid;
      if (amt > remaining) throw new Error(`Payment exceeds balance due of ${remaining}`);

      const payRes = await client.query(
        `INSERT INTO payments (company_id, payment_type, payment_number, payment_date, party_id, amount, payment_mode, reference_number, notes, created_by)
         VALUES ($1, 'incoming', $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [companyId, `PAY-${Date.now()}`, inv.party_id, amt, payment_mode || 'cash', reference_number || null, `Allocation for ${inv.invoice_number}`, req.user!.id]
      );

      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount)
         VALUES ($1, $2, $3)`,
        [payRes.rows[0].id, id, amt]
      );

      const newPaid = currentPaid + amt;
      await client.query(
        `UPDATE invoices
         SET paid_amount = $1,
             payment_status = $2,
             payment_mode = COALESCE($3, payment_mode),
             updated_at = NOW()
         WHERE id = $4 AND company_id = $5`,
        [newPaid, paymentStatusFor(total, newPaid), payment_mode || null, id, companyId]
      );

      if (inv.party_id) {
        await client.query(
          `UPDATE parties
           SET balance = balance - $1
           WHERE id = $2 AND company_id = $3`,
          [amt, inv.party_id, companyId]
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           VALUES ($1, $2, 'credit', $3, (SELECT balance FROM parties WHERE id = $2), 'payment', $4, $5, $6)`,
          [companyId, inv.party_id, amt, id, `Payment for ${inv.invoice_number}`, req.user!.id]
        );
      }

      return { payment_id: payRes.rows[0].id, paid_amount: newPaid, balance_due: total - newPaid };
    });

    res.json(success({ message: 'Payment tracked', ...result }));
  } catch (err: any) {
    console.error('invoiceController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}
