import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { generateDeliveryChallanPDF } from '../services/pdfService';

async function nextChallanNumber(companyId: string, client: any) {
  const yr = new Date().getFullYear().toString().slice(-2);
  const res = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM delivery_challans WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  const seq = String((res.rows[0].cnt || 0) + 1).padStart(4, '0');
  return `DC/${yr}/${seq}`;
}

function normalizeChallanItemAmount(it: any) {
  const quantity = Number(it.quantity) || 0;
  const unitPrice = Math.max(0, Math.round(Number(it.unit_price) || 0));
  const gstRate = Math.max(0, Number(it.gst_rate) || 0);
  const discountAmount = Math.max(0, Math.round(Number(it.discount_amount) || 0));
  const grossAmount = Math.round(quantity * unitPrice);
  const taxableAmount = Math.max(0, grossAmount - discountAmount);
  const gstAmount = Math.round((taxableAmount * gstRate) / 100);
  return {
    quantity,
    unitPrice,
    gstRate,
    discountAmount,
    taxableAmount,
    gstAmount,
    totalAmount: taxableAmount + gstAmount,
  };
}

export async function listDeliveryChallans(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { status, search, limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: string[] = ['c.company_id = $1', 'c.is_deleted = false'];
    const values: any[] = [companyId];
    let idx = 2;

    if (status) { conditions.push(`c.status = $${idx++}`); values.push(status); }
    if (search) {
      conditions.push(`(c.challan_number ILIKE $${idx} OR c.party_name_snapshot ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.join(' AND ');
    const [rows, countRes] = await Promise.all([
      query(
        `SELECT c.*, p.name AS party_name, p.phone AS party_phone,
                so.so_number
         FROM delivery_challans c
         LEFT JOIN parties p ON p.id = c.party_id
         LEFT JOIN sale_orders so ON so.id = c.so_id
         WHERE ${where} ORDER BY c.challan_date DESC, c.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM delivery_challans c WHERE ${where}`, values),
    ]);

    const total = countRes.rows[0].total;
    res.json(success({
      data: rows.rows,
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getDeliveryChallan(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const [challanRes, itemsRes] = await Promise.all([
      query(
        `SELECT c.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email, p.gstin AS party_gstin, p.pan AS party_pan,
                p.billing_address AS party_address, p.billing_state AS party_state, p.billing_state_code AS party_state_code,
                so.so_number
         FROM delivery_challans c
         LEFT JOIN parties p ON p.id = c.party_id
         LEFT JOIN sale_orders so ON so.id = c.so_id
         WHERE c.id = $1 AND c.company_id = $2 AND c.is_deleted = false`,
        [id, companyId],
      ),
      query(`SELECT * FROM delivery_challan_items WHERE challan_id = $1 ORDER BY created_at`, [id]),
    ]);
    if (!challanRes.rows.length) return res.status(404).json(error('Delivery challan not found'));
    res.json(success({ ...challanRes.rows[0], items: itemsRes.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createDeliveryChallan(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    const inputItems = Array.isArray(d.items) ? d.items : [];
    if (!inputItems.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const challanNumber = d.challan_number?.trim() || await nextChallanNumber(companyId, client);

      const partySnap = d.party_id
        ? await client.query(`SELECT name, gstin, billing_address FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };
      const party = partySnap.rows[0];

      const totalAmount = inputItems.reduce(
        (sum: number, it: any) => sum + normalizeChallanItemAmount(it).totalAmount,
        0,
      );

      const challanRes = await client.query(
        `INSERT INTO delivery_challans
           (company_id, party_id, so_id, challan_number, challan_date, due_date, status,
            transport_name, vehicle_number, lr_number, notes, total_amount,
            party_name_snapshot, party_gstin_snapshot, party_address_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          companyId, d.party_id || null, d.so_id || null, challanNumber,
          d.challan_date || new Date().toISOString().split('T')[0],
          d.due_date || null,
          d.status || 'open',
          d.transport_name || null, d.vehicle_number || null, d.lr_number || null,
          d.notes || null, totalAmount,
          party?.name || d.party_name || null,
          party?.gstin || null,
          party?.billing_address || null,
          req.user!.id,
        ],
      );
      const challanId = challanRes.rows[0].id;

      for (const it of inputItems) {
        const amount = normalizeChallanItemAmount(it);
        await client.query(
          `INSERT INTO delivery_challan_items
             (challan_id, item_id, so_item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate, discount_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [challanId, it.item_id || null, it.so_item_id || null,
           it.item_name || it.name, it.hsn_code || null, it.unit || null,
           amount.quantity, amount.unitPrice, amount.gstRate, amount.discountAmount],
        );
      }
      return challanRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getDeliveryChallanPDF(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const [companyRes, challanRes, itemsRes] = await Promise.all([
      query('SELECT * FROM companies WHERE id = $1 AND is_deleted = false', [companyId]),
      query(
        `SELECT c.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email, p.gstin AS party_gstin, p.pan AS party_pan,
                p.billing_address AS party_address, p.billing_state AS party_state, p.billing_state_code AS party_state_code
         FROM delivery_challans c
         LEFT JOIN parties p ON p.id = c.party_id AND p.company_id = c.company_id
         WHERE c.id = $1 AND c.company_id = $2 AND c.is_deleted = false`,
        [id, companyId],
      ),
      query('SELECT * FROM delivery_challan_items WHERE challan_id = $1 ORDER BY created_at', [id]),
    ]);
    if (!companyRes.rows.length) return res.status(404).json(error('Company not found'));
    if (!challanRes.rows.length) return res.status(404).json(error('Delivery challan not found'));
    const pdf = await generateDeliveryChallanPDF(challanRes.rows[0], companyRes.rows[0], itemsRes.rows);
    const inline = String(req.query.inline || '') === '1';
    const filename = `${challanRes.rows[0].challan_number || 'delivery-challan'}.pdf`.replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename=${filename}`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json(error(err.message || 'Failed to generate delivery challan PDF'));
  }
}

export async function updateChallanStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user!.company_id;
    const allowed = ['open', 'dispatched', 'delivered', 'converted', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json(error('Invalid status'));
    const r = await query(
      `UPDATE delivery_challans SET status = $1 WHERE id = $2 AND company_id = $3 AND is_deleted = false RETURNING *`,
      [status, id, companyId],
    );
    if (!r.rows.length) return res.status(404).json(error('Not found'));
    res.json(success(r.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

/**
 * Convert a delivery challan to a sales invoice.
 * Calls the existing invoice creation logic by proxying through invoice route
 * but simpler: we build the invoice payload here directly.
 */
export async function convertChallanToInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const d = req.body; // { invoice_date?, invoice_number?, payment_mode? }

    const [challanRes, itemsRes] = await Promise.all([
      query(
        `SELECT c.*, p.gstin AS party_gstin FROM delivery_challans c
         LEFT JOIN parties p ON p.id = c.party_id
         WHERE c.id = $1 AND c.company_id = $2 AND c.is_deleted = false AND c.status != 'converted'`,
        [id, companyId],
      ),
      query(`SELECT * FROM delivery_challan_items WHERE challan_id = $1 ORDER BY created_at`, [id]),
    ]);

    if (!challanRes.rows.length) return res.status(404).json(error('Challan not found or already converted'));
    const challan = challanRes.rows[0];

    // Auto-generate invoice number
    const yr = new Date().getFullYear().toString().slice(-2);
    const numRes = await query(
      `SELECT COUNT(*)::int AS cnt FROM invoices WHERE company_id = $1 AND is_deleted = false`,
      [companyId],
    );
    const seq = String((numRes.rows[0].cnt || 0) + 1).padStart(4, '0');
    const invoiceNumber = d.invoice_number?.trim() || `INV/${yr}/${seq}`;

    const result = await withTransaction(async (client) => {
      // Create invoice
      const totalAmount = itemsRes.rows.reduce(
        (s: number, it: any) => s + Math.round(Number(it.quantity) * Number(it.unit_price)), 0,
      );

      const invRes = await client.query(
        `INSERT INTO invoices
           (company_id, party_id, invoice_number, invoice_date, invoice_type, status, payment_mode,
            subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount,
            round_off, total_amount, paid_amount, payment_status, balance_due,
            party_name, party_gstin, challan_number, created_by)
         VALUES ($1,$2,$3,$4,'b2b','unpaid',$5,$6,0,$6,0,0,0,0,0,$6,0,'unpaid',$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          companyId, challan.party_id, invoiceNumber,
          d.invoice_date || new Date().toISOString().split('T')[0],
          d.payment_mode || 'credit',
          totalAmount,
          challan.party_name_snapshot, challan.party_gstin_snapshot,
          challan.challan_number, req.user!.id,
        ],
      );
      const invoiceId = invRes.rows[0].id;

      // Insert invoice items
      for (const it of itemsRes.rows) {
        const lineTotal = Math.round(Number(it.quantity) * Number(it.unit_price));
        const gstAmt = Math.round(lineTotal * Number(it.gst_rate) / 100);
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id, item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate,
              cgst_rate, sgst_rate, igst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,0,$10,$11,$11,0,$12)`,
          [invoiceId, it.item_id, it.item_name, it.hsn_code, it.unit,
           it.quantity, it.unit_price, it.gst_rate,
           Number(it.gst_rate) / 2, // cgst_rate = sgst_rate = half
           lineTotal, Math.round(gstAmt / 2), lineTotal + gstAmt],
        );
      }

      // Update party balance
      if (challan.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2`,
          [totalAmount, challan.party_id],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration)
           SELECT $1, $2, 'debit', $3, balance, 'invoice', $4, 'Converted from challan ' || $5
           FROM parties WHERE id = $2`,
          [companyId, challan.party_id, totalAmount, invoiceId, challan.challan_number],
        );
      }

      // Mark challan as converted
      await client.query(
        `UPDATE delivery_challans SET status = 'converted', invoice_id = $1 WHERE id = $2`,
        [invoiceId, id],
      );

      return { invoice_id: invoiceId, invoice_number: invoiceNumber };
    });

    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
