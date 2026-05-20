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
import { getUploadUrl } from '../services/fileUpload';

const ALLOWED_PDF_TEMPLATES = ['standard', 'simple', 'performa', 'monochrome'] as const;
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

function trimOrNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

const INVOICE_NUMBER_PATTERN = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const INVOICE_NUMBER_MESSAGE =
  'Invoice number must be 1-16 characters, start with A-Z or 1-9, and only contain letters, numbers, / or -.';

function validateInvoiceNumber(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!INVOICE_NUMBER_PATTERN.test(s)) {
    throw new Error(INVOICE_NUMBER_MESSAGE);
  }
  return s;
}

async function assertInvoiceNumberAvailable(
  db: Queryable,
  companyId: string,
  invoiceNumber: string,
  excludeInvoiceId?: string,
) {
  const params: any[] = [companyId, invoiceNumber];
  let extra = '';
  if (excludeInvoiceId) {
    params.push(excludeInvoiceId);
    extra = ` AND id <> $${params.length}`;
  }
  const dup = await db.query(
    `SELECT id FROM invoices
     WHERE company_id = $1 AND invoice_number = $2 AND is_deleted = false${extra}
     LIMIT 1`,
    params,
  );
  if (dup.rows.length) {
    throw new Error(`Invoice number "${invoiceNumber}" is already used. Please enter a unique invoice number.`);
  }
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

function stateCodeFromGstin(value: unknown): string {
  const gstin = String(value || '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(gstin) ? gstin.slice(0, 2) : '';
}

async function resolveDefaultGodownId(db: Queryable, companyId: string, requested?: unknown, userGodownId?: string | null): Promise<string | null> {
  const requestedId = trimOrNull(requested);
  if (requestedId) return requestedId;
  if (userGodownId) return userGodownId;
  const res = await db.query(
    `SELECT id FROM godowns
     WHERE company_id = $1 AND is_deleted = false AND is_active = true
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [companyId],
  );
  if (res.rows[0]?.id) return res.rows[0].id;
  const created = await db.query(
    `INSERT INTO godowns (company_id, name, code, is_default, is_active)
     VALUES ($1, 'Default', 'DEFAULT', true, true)
     RETURNING id`,
    [companyId],
  );
  return created.rows[0]?.id || null;
}

async function deductSaleStockAllowNegative(
  db: Queryable,
  args: {
    companyId: string;
    itemId: string;
    godownId: string | null;
    invoiceId: string;
    quantity: number;
    userId: string;
  },
) {
  const qty = Number(args.quantity) || 0;
  if (qty <= 0) throw new Error('Invalid quantity for stock item');
  if (!args.godownId) {
    throw new Error('Create or select a godown before selling inventory-tracked items.');
  }

  await db.query(
    `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (item_id, godown_id) DO NOTHING`,
    [args.companyId, args.itemId, args.godownId],
  );

  await db.query(
    `UPDATE item_stock
     SET quantity = quantity - $1::numeric
     WHERE company_id = $2 AND item_id = $3 AND godown_id = $4`,
    [qty, args.companyId, args.itemId, args.godownId],
  );

  const balRes = await db.query(
    'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3',
    [args.itemId, args.godownId, args.companyId],
  );

  await db.query(
    `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
     VALUES ($1, $2, $3, 'sale', 'invoice', $4, $5, $6, $7, $8)`,
    [
      args.companyId,
      args.itemId,
      args.godownId,
      args.invoiceId,
      -qty,
      balRes.rows[0]?.quantity || 0,
      'Sale invoice stock deduction; negative stock allowed',
      args.userId,
    ],
  );
}

async function resolveInvoiceGstContext(
  db: Queryable,
  companyId: string,
  partyId: unknown,
  explicitPlaceOfSupply: string,
  requestedIsInterstate: unknown,
): Promise<{ placeOfSupply: string | null; isInterstate: boolean }> {
  const cRes = await db.query('SELECT state_code, gstin FROM companies WHERE id = $1', [companyId]);
  const companyState = stateCodeFromGstin(cRes.rows[0]?.gstin) || String(cRes.rows[0]?.state_code || '').slice(0, 2);

  let partyState = '';
  if (partyId) {
    const pRes = await db.query(
      `SELECT gstin, billing_state_code, state_code
       FROM parties
       WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [partyId, companyId],
    );
    partyState =
      stateCodeFromGstin(pRes.rows[0]?.gstin) ||
      String(pRes.rows[0]?.billing_state_code || pRes.rows[0]?.state_code || '').slice(0, 2);
  }

  const placeOfSupply = (explicitPlaceOfSupply || partyState || '').slice(0, 5) || null;
  if (companyState && placeOfSupply) {
    return { placeOfSupply, isInterstate: determineGSTType(companyState, placeOfSupply) === 'inter' };
  }
  return { placeOfSupply, isInterstate: Boolean(requestedIsInterstate) };
}

function normalizeInvoicePayments(d: any, totalAmount: number) {
  const rows = Array.isArray(d.payments) && d.payments.length
    ? d.payments
    : Number(d.amount_paid || 0) > 0
      ? [{
          amount: d.amount_paid,
          payment_mode: d.payment_mode || 'cash',
          reference_number: d.payment_reference_number || d.reference_number,
          cheque_number: d.cheque_number,
          company_bank_account_id: d.company_bank_account_id,
        }]
      : [];

  const normalized = rows
    .map((row: any) => {
      const paymentMode = String(row.payment_mode || row.type || 'cash').trim().toLowerCase();
      const amount = Math.round(Number(row.amount) || 0);
      return {
        payment_mode: paymentMode,
        amount,
        reference_number: trimOrNull(row.reference_number),
        cheque_number: trimOrNull(row.cheque_number),
        instrument_date: trimOrNull(row.instrument_date),
        company_bank_account_id: trimOrNull(row.company_bank_account_id),
        notes: trimOrNull(row.notes),
      };
    })
    .filter((row: any) => row.payment_mode !== 'credit' && row.amount > 0);

  const paidAmount = normalized.reduce((sum: number, row: any) => sum + row.amount, 0);
  if (paidAmount < 0) throw new Error('Amount paid cannot be negative');
  if (paidAmount > totalAmount) throw new Error('Amount paid cannot exceed invoice total');
  for (const row of normalized) {
    if (row.payment_mode === 'cheque' && !row.cheque_number && !row.reference_number) {
      throw new Error('Cheque number is required for cheque payments');
    }
  }
  return { payments: normalized, paidAmount };
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
      `SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.selling_price as unit_price, i.gst_rate,
              i.item_type, i.track_inventory,
              COALESCE(u.abbreviation, u.name, 'PCS') as unit
       ${godownSelect}
       FROM items i
       LEFT JOIN item_units u ON u.id = i.unit_id
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
      `SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.selling_price as unit_price, i.gst_rate,
              i.item_type, i.track_inventory,
              COALESCE(u.abbreviation, u.name, 'PCS') as unit
       ${godownSelect}
       FROM items i
       LEFT JOIN item_units u ON u.id = i.unit_id
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
      const godownId = await resolveDefaultGodownId(client, companyId, d.godown_id, req.user!.godown_id);

      const requestedInvoiceNumber = trimOrNull(d.invoice_number);
      let invoiceNumber = '';
      if (requestedInvoiceNumber) {
        invoiceNumber = validateInvoiceNumber(requestedInvoiceNumber);
        await assertInvoiceNumberAvailable(client, companyId, invoiceNumber);
      } else {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          invoiceNumber = validateInvoiceNumber(await generateInvoiceNumber(companyId, rawType, godownId));
          try {
            await assertInvoiceNumberAvailable(client, companyId, invoiceNumber);
            break;
          } catch (err: any) {
            if (attempt === 4 || !/already used/i.test(err?.message || '')) throw err;
          }
        }
      }

      const explicitPlaceOfSupply = String(d.place_of_supply || '').trim().slice(0, 5);
      const gstContext = await resolveInvoiceGstContext(client, companyId, d.party_id, explicitPlaceOfSupply, d.is_interstate);
      const isInterstate = gstContext.isInterstate;

      const gstType = isInterstate ? 'inter' : 'intra';
      const invDisc = Math.round(Number(d.discount_amount) || 0);
      const totalsInfo = calculateInvoiceTotals(
        mappedItems,
        gstType,
        invDisc > 0 ? 'flat' : 'none',
        invDisc,
      );

      const { payments: paymentRows, paidAmount: amountPaid } = normalizeInvoicePayments(d, totalsInfo.totalAmount);
      const paymentStatus = paymentStatusFor(totalsInfo.totalAmount, amountPaid);

      const status = 'confirmed';

      let partySnap: { name?: string; gstin?: string; bill?: string; ship?: string; phone?: string | null; email?: string | null } = {};
      if (d.party_id) {
        const pr = await client.query(
          `SELECT name, gstin, phone, email, billing_address, shipping_address FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId]
        );
        if (pr.rows[0]) {
          partySnap = {
            name: pr.rows[0].name,
            gstin: pr.rows[0].gstin,
            phone: trimOrNull(d.party_phone) || pr.rows[0].phone || null,
            email: trimOrNull(d.party_email) || pr.rows[0].email || null,
            bill: pr.rows[0].billing_address,
            ship: trimOrNull(d.shipping_address) || pr.rows[0].shipping_address || pr.rows[0].billing_address,
          };
        }
      } else {
        const manualPartyName = trimOrNull(d.party_name) || trimOrNull(d.party_name_snapshot);
        const manualShipping = trimOrNull(d.shipping_address);
        const manualBilling = trimOrNull(d.billing_address) || manualShipping;
        partySnap = {
          name: manualPartyName || undefined,
          phone: trimOrNull(d.party_phone),
          email: trimOrNull(d.party_email),
          bill: manualBilling || undefined,
          ship: manualShipping || manualBilling || undefined,
        };
      }

      const compEinv = await client.query(
        `SELECT einvoice_enabled, einvoice_turnover_above_5cr FROM companies WHERE id = $1`,
        [companyId]
      );
      const einvOn = compEinv.rows[0]?.einvoice_enabled && compEinv.rows[0]?.einvoice_turnover_above_5cr;
      const einvoiceStatus = einvOn ? 'pending' : 'not_applicable';

      const placeOfSupply = gstContext.placeOfSupply;

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const invRes = await client.query(
        `INSERT INTO invoices (
          company_id, invoice_number, invoice_type, party_id, godown_id,
          invoice_date, due_date, is_interstate, place_of_supply,
          party_name_snapshot, party_gstin_snapshot, party_phone_snapshot, party_email_snapshot, billing_address_snapshot, shipping_address_snapshot,
          subtotal, discount_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, total_amount,
          paid_amount, payment_status, payment_mode, status, einvoice_status,
          notes, external_description, terms_and_conditions, created_by, pdf_template, document_theme,
          company_bank_account_id, bank_label_snapshot, bank_name_snapshot, bank_account_number_snapshot,
          bank_ifsc_snapshot, bank_branch_snapshot, upi_id_snapshot
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
          $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
          $35,$36,$37,$38,$39,$40,$41,$42
        ) RETURNING *`,
        [
          companyId, invoiceNumber, invoiceType, d.party_id || null, godownId,
          d.invoice_date || new Date().toISOString().split('T')[0],
          d.due_date || null,
          isInterstate,
          placeOfSupply,
          partySnap.name || null,
          partySnap.gstin || null,
          partySnap.phone || null,
          partySnap.email || null,
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
          paymentRows[0]?.payment_mode || d.payment_mode || null,
          status,
          einvoiceStatus,
          d.notes || null,
          d.external_description || null,
          d.terms_and_conditions || null,
          req.user!.id,
          ALLOWED_PDF_TEMPLATES.includes(String(d.pdf_template || '') as any) ? d.pdf_template : 'monochrome',
          ALLOWED_DOCUMENT_THEMES.includes(String(d.document_theme || '') as any) ? d.document_theme : 'executive',
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

        if (item.item_id && !isPurchase) {
          const itemRes = await client.query(
            `SELECT name, track_inventory
             FROM items
             WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [item.item_id, companyId]
          );
          if (!itemRes.rows.length) throw new Error(`Item not found for line ${i + 1}`);

          if (itemRes.rows[0].track_inventory) {
            await deductSaleStockAllowNegative(client, {
              companyId,
              itemId: item.item_id,
              godownId,
              invoiceId: invoice.id,
              quantity: item.quantity,
              userId: req.user!.id,
            });
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

      for (const row of paymentRows) {
        const payRes = await client.query(
          `INSERT INTO payments (
             company_id, payment_type, payment_number, payment_date, party_id, amount,
             payment_mode, reference_number, company_bank_account_id, cheque_number, instrument_date,
             clearance_status, notes, payment_source, source_id, source_label, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'invoice', $14, $15, $16) RETURNING id`,
          [
            companyId,
            isPurchase ? 'outgoing' : 'incoming',
            `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            invoice.invoice_date,
            d.party_id || null,
            row.amount,
            row.payment_mode || 'cash',
            row.reference_number || null,
            row.company_bank_account_id || null,
            row.cheque_number || (row.payment_mode === 'cheque' ? row.reference_number || null : null),
            row.instrument_date || null,
            row.payment_mode === 'cheque' ? 'pending' : 'cleared',
            row.notes || `Payment on ${invoice.invoice_number}`,
            invoice.id,
            invoice.invoice_number,
            req.user!.id,
          ]
        );
        await client.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount)
           VALUES ($1, $2, $3)`,
          [payRes.rows[0].id, invoice.id, row.amount]
        );
      }

      return invoice;
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('createInvoice error:', err.message, err.detail, err.position);
    const msg = err?.message || 'Failed to create invoice';
    const status = /At least one|Use the purchase module|cannot|Insufficient|No stock row|not found|Invalid quantity|Invoice number/i.test(msg) ? 400 : 500;
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
      `SELECT i.*, COALESCE(i.party_name_snapshot, p.name) as party_name,
              COALESCE(i.party_phone_snapshot, p.phone) as party_phone,
              COALESCE(i.party_email_snapshot, p.email) as party_email,
              dc.id AS delivery_challan_id,
              dc.challan_number AS delivery_challan_number
       FROM invoices i LEFT JOIN parties p ON i.party_id = p.id
       LEFT JOIN delivery_challans dc ON dc.invoice_id = i.id AND dc.company_id = i.company_id AND dc.is_deleted = false
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
              COALESCE(i.party_phone_snapshot, p.phone) as party_phone,
              COALESCE(i.party_email_snapshot, p.email) as party_email,
              COALESCE(i.party_gstin_snapshot, p.gstin) as party_gstin,
              p.pan as party_pan,
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
              dc.id AS delivery_challan_id,
              dc.challan_number AS delivery_challan_number,
              c.einvoice_enabled, c.einvoice_turnover_above_5cr
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.company_id = i.company_id AND p.is_deleted = false
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN delivery_challans dc ON dc.invoice_id = i.id AND dc.company_id = i.company_id AND dc.is_deleted = false
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
    const attRes = await query(
      `SELECT *
       FROM invoice_attachments
       WHERE invoice_id = $1 AND company_id = $2 AND is_deleted = false
       ORDER BY created_at DESC`,
      [id, req.user!.company_id],
    );

    res.json(success({
      ...row,
      items: itemsRes.rows,
      payments: payRes.rows,
      attachments: attRes.rows,
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
      if (oldInv.irn && oldInv.einvoice_status === 'generated') throw new Error('Cannot edit an invoice with an active e-invoice IRN. Cancel the IRN first.');
      if (oldInv.invoice_type === 'purchase') throw new Error('Purchase bills are edited under Purchases, not here.');
      if (!['sale', 'tax_invoice'].includes(String(oldInv.invoice_type || ''))) {
        throw new Error('This invoice type cannot be edited from the sales form.');
      }

      const nextInvoiceNumber = d.invoice_number !== undefined
        ? validateInvoiceNumber(d.invoice_number)
        : validateInvoiceNumber(oldInv.invoice_number);
      if (nextInvoiceNumber !== oldInv.invoice_number) {
        await assertInvoiceNumberAvailable(client, companyId, nextInvoiceNumber, id);
      }

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

      const explicitPlaceOfSupply = String(d.place_of_supply || '').trim().slice(0, 5);
      const gstContext = await resolveInvoiceGstContext(client, companyId, d.party_id, explicitPlaceOfSupply, d.is_interstate);
      const isInterstate = gstContext.isInterstate;

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

      let partySnap: { name?: string; gstin?: string; bill?: string; ship?: string; phone?: string | null; email?: string | null } = {};
      if (d.party_id) {
        const pr = await client.query(
          `SELECT name, gstin, phone, email, billing_address, shipping_address FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId],
        );
        if (pr.rows[0]) {
          partySnap = {
            name: pr.rows[0].name,
            gstin: pr.rows[0].gstin,
            phone: trimOrNull(d.party_phone) || pr.rows[0].phone || null,
            email: trimOrNull(d.party_email) || pr.rows[0].email || null,
            bill: pr.rows[0].billing_address,
            ship: trimOrNull(d.shipping_address) || pr.rows[0].shipping_address || pr.rows[0].billing_address,
          };
        }
      } else {
        const manualPartyName = trimOrNull(d.party_name) || trimOrNull(d.party_name_snapshot);
        const manualShipping = trimOrNull(d.shipping_address);
        const manualBilling = trimOrNull(d.billing_address) || manualShipping;
        partySnap = {
          name: manualPartyName || undefined,
          phone: trimOrNull(d.party_phone),
          email: trimOrNull(d.party_email),
          bill: manualBilling || undefined,
          ship: manualShipping || manualBilling || undefined,
        };
      }

      const placeOfSupply = gstContext.placeOfSupply;

      const bankSnap = await resolveBankSnapshotsForInsert(client, companyId, d.company_bank_account_id);

      const pdfTpl = ALLOWED_PDF_TEMPLATES.includes(String(d.pdf_template || '') as any) ? d.pdf_template : oldInv.pdf_template;
      const docTheme = ALLOWED_DOCUMENT_THEMES.includes(String(d.document_theme || '') as any)
        ? d.document_theme
        : oldInv.document_theme || 'executive';
      const updatedGodownId = await resolveDefaultGodownId(client, companyId, d.godown_id, req.user!.godown_id);
      const updatedPaymentStatus = paymentStatusFor(totalsInfo.totalAmount, Number(oldInv.paid_amount || 0));

      await client.query(
        `UPDATE invoices SET
          party_id = $1, godown_id = $2, invoice_date = $3, due_date = $4, is_interstate = $5, place_of_supply = $6,
          party_name_snapshot = $7, party_gstin_snapshot = $8, party_phone_snapshot = $9, party_email_snapshot = $10,
          billing_address_snapshot = $11, shipping_address_snapshot = $12,
          subtotal = $13, discount_amount = $14, taxable_amount = $15,
          cgst_amount = $16, sgst_amount = $17, igst_amount = $18, cess_amount = $19, round_off = $20, total_amount = $21,
          payment_status = $37, notes = $22, external_description = $23, pdf_template = $24, document_theme = $25,
          is_gst_invoice = $26,
          company_bank_account_id = $27, bank_label_snapshot = $28, bank_name_snapshot = $29,
          bank_account_number_snapshot = $30, bank_ifsc_snapshot = $31, bank_branch_snapshot = $32, upi_id_snapshot = $33,
          invoice_number = $34,
          updated_at = NOW()
        WHERE id = $35 AND company_id = $36`,
        [
          d.party_id || null,
          updatedGodownId,
          d.invoice_date || oldInv.invoice_date,
          d.due_date ?? oldInv.due_date,
          isInterstate,
          placeOfSupply,
          partySnap.name || null,
          partySnap.gstin || null,
          partySnap.phone || null,
          partySnap.email || null,
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
          d.external_description ?? oldInv.external_description,
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
          nextInvoiceNumber,
          id,
          companyId,
          updatedPaymentStatus,
        ],
      );

      const godownId = updatedGodownId;
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

        if (item.item_id) {
          const itemRes = await client.query(
            `SELECT name, track_inventory FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [item.item_id, companyId],
          );
          if (!itemRes.rows.length) throw new Error(`Item not found for line ${i + 1}`);
          if (itemRes.rows[0].track_inventory) {
            await deductSaleStockAllowNegative(client, {
              companyId,
              itemId: item.item_id,
              godownId,
              invoiceId: id,
              quantity: item.quantity,
              userId: req.user!.id,
            });
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
          [companyId, d.party_id, 'debit', totalsInfo.totalAmount, id, nextInvoiceNumber, req.user!.id],
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
    const status = /not found|Cannot edit|Insufficient|No stock row|Invalid quantity|At least one|Invoice number/i.test(msg) ? 400 : 500;
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
      if (inv.irn && inv.einvoice_status === 'generated') throw new Error('Cancel e-invoice IRN before cancelling this invoice');

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

    const result = await withTransaction(async (client) => {
      const invRes = await client.query(
        `SELECT *
         FROM invoices
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR UPDATE`,
        [id, companyId],
      );
      if (!invRes.rows.length) throw new Error('Invoice not found');
      const inv = invRes.rows[0];
      if (inv.irn && inv.einvoice_status === 'generated') throw new Error('This invoice has an active IRN. Cancel e-invoice before deleting.');

      await backupInvoiceSnapshot(client, companyId, id, 'delete_invoice', req.user!.id);

      if (inv.status !== 'draft' && inv.status !== 'cancelled') {
        const itemsRes = await client.query(
          `SELECT ii.*, it.name AS item_master_name, it.track_inventory
           FROM invoice_items ii
           LEFT JOIN items it ON it.id = ii.item_id
           WHERE ii.invoice_id = $1 AND ii.company_id = $2
           ORDER BY ii.sort_order, ii.id`,
          [id, companyId],
        );

        if (inv.invoice_type !== 'purchase' && inv.godown_id) {
          for (const row of itemsRes.rows) {
            if (!row.item_id || !row.track_inventory) continue;
            const qty = Number(row.quantity) || 0;
            await client.query(
              `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
               VALUES ($1, $2, $3, $4, 0)
               ON CONFLICT (item_id, godown_id) DO UPDATE SET
                 quantity = item_stock.quantity + EXCLUDED.quantity`,
              [companyId, row.item_id, inv.godown_id, qty],
            );
            const balRes = await client.query(
              `SELECT quantity
               FROM item_stock
               WHERE company_id = $1 AND item_id = $2 AND godown_id = $3`,
              [companyId, row.item_id, inv.godown_id],
            );
            await client.query(
              `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
               VALUES ($1, $2, $3, 'sale_delete', 'invoice', $4, $5, $6, $7, $8)`,
              [companyId, row.item_id, inv.godown_id, inv.id, qty, balRes.rows[0]?.quantity || qty, `Deleted ${inv.invoice_number}`, req.user!.id],
            );
          }
        }

        if (inv.party_id) {
          const partyDelta = inv.invoice_type === 'purchase' ? Number(inv.total_amount || 0) : -Number(inv.total_amount || 0);
          await client.query(
            `UPDATE parties
             SET balance = balance + $1
             WHERE id = $2 AND company_id = $3`,
            [partyDelta, inv.party_id, companyId],
          );
          await client.query(
            `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
             VALUES (
               $1, $2, $3, $4,
               (SELECT balance FROM parties WHERE id = $2),
               'invoice_delete', $5, $6, $7
             )`,
            [
              companyId,
              inv.party_id,
              inv.invoice_type === 'purchase' ? 'debit' : 'credit',
              Number(inv.total_amount || 0),
              inv.id,
              `Deleted ${inv.invoice_number}`,
              req.user!.id,
            ],
          );
        }
      }

      await client.query(
        `UPDATE invoices
         SET status = CASE WHEN status = 'draft' THEN status ELSE 'cancelled' END,
             is_deleted = true,
             updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [id, companyId],
      );
      return inv;
    });

    await logAction(
      req.user!.id,
      companyId,
      'delete',
      'invoice',
      id,
      { invoice_number: result.invoice_number },
      null,
      req.ip,
      req.get('User-Agent'),
    );
    res.json(success({ message: 'Invoice removed from active records' }));
  } catch (err: any) {
    const msg = err?.message || 'Failed to delete invoice';
    const status = /not found/i.test(msg) ? 404 : /IRN|payments/i.test(msg) ? 400 : 500;
    res.status(status).json(error(msg));
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
    const templateRaw = String(d.template || 'monochrome');
    const template = ALLOWED_PDF_TEMPLATES.includes(templateRaw as any) ? templateRaw : 'monochrome';
    const theme = ALLOWED_DOCUMENT_THEMES.includes(String(d.theme || '') as any) ? String(d.theme) : 'executive';

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

    const explicitPlaceOfSupply = String(d.place_of_supply || '').trim().slice(0, 5);
    let isInterstate = Boolean(d.is_interstate);
    if (explicitPlaceOfSupply) {
      const cRes = await query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      isInterstate = determineGSTType(cRes.rows[0]?.state_code, explicitPlaceOfSupply) === 'inter';
    } else if (d.is_interstate === undefined && d.party_id) {
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
      ? await query(`SELECT gstin, billing_state_code, state_code FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
      : { rows: [{}] };
    const placeOfSupply = (
      explicitPlaceOfSupply ||
      stateCodeFromGstin(posRow.rows[0]?.gstin) ||
      posRow.rows[0]?.billing_state_code ||
      posRow.rows[0]?.state_code ||
      ''
    ).toString().slice(0, 5) || null;

    const partySnap = party
      ? {
          name: party.name as string,
          gstin: party.gstin as string | null,
          bill: party.billing_address as string | null,
          ship: trimOrNull(d.shipping_address) || party.shipping_address || party.billing_address || null,
        }
      : {
          name: String(d.party_name || 'Walk-in Customer'),
          gstin: null as string | null,
          bill: null as string | null,
          ship: trimOrNull(d.shipping_address),
        };

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
        unit: item.unit || 'PCS',
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
      shipping_address_snapshot: partySnap.ship,
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
      `SELECT ii.*, it.item_type, it.track_inventory
       FROM invoice_items ii
       LEFT JOIN items it ON it.id = ii.item_id AND it.company_id = ii.company_id
       WHERE ii.invoice_id = $1 AND ii.company_id = $2
       ORDER BY ii.sort_order, ii.id`,
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

    const cleanTransporterId = String(transporter_id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleanTransporterId && cleanTransporterId.length !== 15) {
      return res.status(400).json(error('transporter_id must be blank or a 15-character transporter GSTIN / TRANSIN'));
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
    if (company.eway_bill_only_above_50k && Number(inv.total_amount || 0) <= 5000000) {
      return res.status(400).json(error('Company setting allows E-Way Bill generation only for invoices above ₹50,000.'));
    }

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
          billing_state_code: pRes.rows[0].billing_state_code || inv.place_of_supply,
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
      transporter_id: cleanTransporterId,
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
          customer_state_code: party.billing_state_code || inv.place_of_supply,
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
    if (!invRes.rows[0].irn || invRes.rows[0].einvoice_status !== 'generated') {
      return res.status(400).json(error('This invoice does not have an active e-invoice IRN.'));
    }
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

export async function addInvoiceAttachment(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const invRes = await query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [id, companyId],
    );
    if (!invRes.rows.length) return res.status(404).json(error('Invoice not found'));

    const fileUrl = req.file ? getUploadUrl(req.file.path) : null;
    const attachmentType = trimOrNull(req.body?.attachment_type) || (fileUrl ? 'document' : 'description');
    const description = trimOrNull(req.body?.description);
    if (!fileUrl && !description) return res.status(400).json(error('Upload a file or add a description'));

    const saved = await query(
      `INSERT INTO invoice_attachments (
         company_id, invoice_id, attachment_type, file_url, original_name,
         description, mime_type, file_size, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        companyId,
        id,
        attachmentType,
        fileUrl,
        req.file?.originalname || null,
        description,
        req.file?.mimetype || null,
        req.file?.size || null,
        req.user!.id,
      ],
    );
    res.status(201).json(success(saved.rows[0]));
  } catch (err: any) {
    console.error('addInvoiceAttachment error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message || 'Failed to save invoice attachment'));
  }
}

export async function recordPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { amount, payment_mode, reference_number, company_bank_account_id, cheque_number, instrument_date } = req.body;
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
        `INSERT INTO payments (
           company_id, payment_type, payment_number, payment_date, party_id, amount,
           payment_mode, reference_number, company_bank_account_id, cheque_number, instrument_date, notes, created_by
         )
         VALUES ($1, 'incoming', $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          companyId,
          `PAY-${Date.now()}`,
          inv.party_id,
          amt,
          payment_mode || 'cash',
          reference_number || null,
          company_bank_account_id || null,
          cheque_number || (payment_mode === 'cheque' ? reference_number || null : null),
          instrument_date || null,
          `Allocation for ${inv.invoice_number}`,
          req.user!.id,
        ]
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
