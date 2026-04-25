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
  type EinvoiceItemRow,
} from '../services/eInvoiceService';
import { redis } from '../config/redis';
import { env } from '../config/env';

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
  return `${prefix}/${branchCode}/${fyShort}/${paddedSeq}`;
}

function mapLineForGst(raw: any) {
  const unitPrice = Math.round(Number(raw.unit_price) || 0);
  const qty = Number(raw.quantity) || 0;
  const lineDisc = Math.round(Number(raw.discount_amount) || 0);
  return {
    unit_price: unitPrice,
    quantity: qty,
    gst_rate: Number(raw.gst_rate) || 0,
    cess_rate: Number(raw.cess_rate) || 0,
    discount_type: lineDisc > 0 ? ('flat' as const) : ('none' as const),
    discount_value: lineDisc,
  };
}

// ── GET /api/invoices/search-items ──────────────────────────────
export async function searchItems(req: Request, res: Response) {
  try {
    const { q, godown_id } = req.query;
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
  } catch (err: any) { res.status(500).json(error(err.message)); }
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
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/invoices ────────────────────────────────────────
export async function createInvoice(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!Array.isArray(d.items) || d.items.length === 0) {
      return res.status(400).json(error('At least one line item is required'));
    }

    const mappedItems = d.items.map((it: any) => mapLineForGst({
      ...it,
      item_name: it.item_name || it.name,
    }));

    const result = await withTransaction(async (client) => {
      const rawType = d.invoice_type || 'tax_invoice';
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

      const invRes = await client.query(
        `INSERT INTO invoices (
          company_id, invoice_number, invoice_type, party_id, godown_id,
          invoice_date, due_date, is_interstate, place_of_supply,
          party_name_snapshot, party_gstin_snapshot, billing_address_snapshot, shipping_address_snapshot,
          subtotal, discount_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, total_amount,
          paid_amount, payment_status, payment_mode, status, einvoice_status,
          notes, terms_and_conditions, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
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
        ]
      );

      const invoice = invRes.rows[0];
      const godownId = d.godown_id || req.user!.godown_id;

      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const lineGst = mapLineForGst({ ...item, item_name: item.item_name || item.name });
        const taxInfo = calculateInvoiceTotals([lineGst], gstType, 'none', 0);

        const gstRt = Number(item.gst_rate) || 0;
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
            item.item_name || item.name || 'Item',
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
          await client.query(
            `UPDATE item_stock SET quantity = quantity - $1::numeric
             WHERE item_id = $2 AND godown_id = $3 AND company_id = $4`,
            [item.quantity, item.item_id, godownId, companyId]
          );

          const balRes = await client.query(
            'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3',
            [item.item_id, godownId, companyId]
          );

          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, created_by)
             VALUES ($1, $2, $3, 'sale', 'invoice', $4, $5, $6, $7)`,
            [companyId, item.item_id, godownId, invoice.id, -Number(item.quantity), balRes.rows[0]?.quantity || 0, req.user!.id]
          );
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
        await client.query(
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
      }

      return invoice;
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function listInvoices(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, status, party_id, invoice_type } = req.query;

    let where = 'i.company_id = $1 AND i.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) { where += ` AND (i.invoice_number ILIKE $${idx} OR p.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (status) { where += ` AND i.status = $${idx}`; params.push(status); idx++; }
    if (party_id) { where += ` AND i.party_id = $${idx}`; params.push(party_id); idx++; }
    if (invoice_type) { where += ` AND i.invoice_type = $${idx}`; params.push(invoice_type); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM invoices i LEFT JOIN parties p ON i.party_id = p.id WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT i.*, p.name as party_name, p.phone as party_phone
       FROM invoices i LEFT JOIN parties p ON i.party_id = p.id
       WHERE ${where} ORDER BY i.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
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
              c.bank_name, c.bank_account_number, c.bank_ifsc, c.upi_id,
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
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function cancelInvoice(req: Request, res: Response) {
  res.json(success({ message: 'Cancel invoice flow not enabled in this build.' }));
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
    if (inv.status === 'cancelled') {
      return res.status(400).json(error('Invoice is already cancelled.'));
    }
    await query(
      `UPDATE invoices SET is_deleted = true, updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
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
    const itemsRes = await query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2 ORDER BY sort_order, id`,
      [id, req.user!.company_id]
    );
    const partyRes = invRes.rows[0].party_id
      ? await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [invRes.rows[0].party_id, req.user!.company_id])
      : { rows: [null] };

    const pdfBuffer = await generateInvoicePDF(invRes.rows[0], companyRes.rows[0], partyRes.rows[0], itemsRes.rows);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${invRes.rows[0].invoice_number}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) { res.status(500).json(error(err.message)); }
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

    const phone = String(row.party_phone || '').replace(/\s+/g, '');
    if (!phone) {
      return res.status(400).json(
        error('Customer has no phone on file. Add a mobile number to the party or share from the invoice screen.'),
      );
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
    if (!company.einvoice_enabled || !company.einvoice_turnover_above_5cr) {
      return res.status(400).json(error('Enable e-invoice and turnover flag in company settings first'));
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
          billing_pincode: pRes.rows[0].billing_pincode,
          billing_state_code: pRes.rows[0].billing_state_code || inv.place_of_supply,
        };
      }
    }

    const payload = buildEinvoicePayload(inv, company, party, itemsRes.rows as EinvoiceItemRow[]);
    const irnData = await generateIRN(payload, company);
    const qrUrl = await generateEinvoiceQR(irnData.irn, inv, env.EINVOICE_MODE, payload);

    await query(
      `UPDATE invoices SET irn = $1, ack_number = $2, ack_date = $3, einvoice_status = $4, qr_code_url = $5, updated_at = now()
       WHERE id = $6 AND company_id = $7`,
      [irnData.irn, irnData.ack_number, irnData.ack_date, 'generated', qrUrl, id, companyId]
    );

    res.json(success({ irn: irnData.irn, ack_number: irnData.ack_number, ack_date: irnData.ack_date, qr_code_url: qrUrl }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
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
  } catch (err: any) { res.status(500).json(error(err.message)); }
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
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function recordPayment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { amount, payment_mode, reference_number } = req.body;
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return res.status(400).json(error('Invalid amount'));

    await query(
      `UPDATE invoices SET paid_amount = paid_amount + $1, payment_mode = COALESCE($3, payment_mode), updated_at = now()
       WHERE id = $2 AND company_id = $4`,
      [amt, id, payment_mode || null, req.user!.company_id]
    );
    await query(
      `INSERT INTO payments (company_id, payment_type, payment_number, payment_date, party_id, amount, payment_mode, reference_number, notes, created_by)
       SELECT $1, 'incoming', $2, CURRENT_DATE, party_id, $3, $4, $5, $6, $7 FROM invoices WHERE id = $8 AND company_id = $9`,
      [req.user!.company_id, `PAY-${Date.now()}`, amt, payment_mode || 'cash', reference_number || null, `Allocation for invoice`, req.user!.id, id, req.user!.company_id]
    );
    res.json(success({ message: 'Payment tracked' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
