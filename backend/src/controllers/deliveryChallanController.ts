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
  const discountAmount = Math.max(0, Math.round(Number(it.discount_amount) || 0));
  const grossAmount = Math.round(quantity * unitPrice);
  const totalAmount = Math.max(0, grossAmount - discountAmount);
  return {
    quantity,
    unitPrice,
    gstRate: 0,
    discountAmount,
    taxableAmount: totalAmount,
    gstAmount: 0,
    totalAmount,
  };
}

function normalizeCurrencyCode(value: unknown): 'INR' | 'USD' {
  return String(value || 'INR').trim().toUpperCase() === 'USD' ? 'USD' : 'INR';
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
      const currencyCode = normalizeCurrencyCode(d.currency_code);

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
            transport_name, vehicle_number, lr_number, notes, total_amount, currency_code,
            party_name_snapshot, party_gstin_snapshot, party_address_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          companyId, d.party_id || null, d.so_id || null, challanNumber,
          d.challan_date || new Date().toISOString().split('T')[0],
          d.due_date || null,
          d.status || 'open',
          d.transport_name || null, d.vehicle_number || null, d.lr_number || null,
          d.notes || null, totalAmount, currencyCode,
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
             (challan_id, item_id, so_item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate, discount_amount, currency_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [challanId, it.item_id || null, it.so_item_id || null,
           it.item_name || it.name, it.hsn_code || null, it.unit || null,
           amount.quantity, amount.unitPrice, 0, amount.discountAmount, currencyCode],
        );
      }
      return challanRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateDeliveryChallan(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const d = req.body;
    const inputItems = Array.isArray(d.items) ? d.items : [];
    if (!inputItems.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM delivery_challans
         WHERE id = $1 AND company_id = $2 AND is_deleted = false
         FOR UPDATE`,
        [id, companyId],
      );
      if (!existing.rows.length) throw new Error('Delivery challan not found');
      if (existing.rows[0].status === 'converted') {
        throw new Error('Converted delivery challans cannot be edited. Edit the linked invoice if needed.');
      }

      const partySnap = d.party_id
        ? await client.query(
            `SELECT name, gstin, billing_address FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
            [d.party_id, companyId],
          )
        : { rows: [] };
      const party = partySnap.rows[0];
      const currencyCode = normalizeCurrencyCode(d.currency_code || existing.rows[0].currency_code);
      const totalAmount = inputItems.reduce(
        (sum: number, it: any) => sum + normalizeChallanItemAmount(it).totalAmount,
        0,
      );

      const challanRes = await client.query(
        `UPDATE delivery_challans SET
           party_id = $1,
           challan_date = $2,
           due_date = $3,
           transport_name = $4,
           vehicle_number = $5,
           lr_number = $6,
           notes = $7,
           total_amount = $8,
           currency_code = $9,
           party_name_snapshot = $10,
           party_gstin_snapshot = $11,
           party_address_snapshot = $12
         WHERE id = $13 AND company_id = $14 AND is_deleted = false
         RETURNING *`,
        [
          d.party_id || null,
          d.challan_date || existing.rows[0].challan_date,
          d.due_date || null,
          d.transport_name || null,
          d.vehicle_number || null,
          d.lr_number || null,
          d.notes || null,
          totalAmount,
          currencyCode,
          party?.name || d.party_name || existing.rows[0].party_name_snapshot || null,
          party?.gstin || null,
          party?.billing_address || null,
          id,
          companyId,
        ],
      );

      await client.query('DELETE FROM delivery_challan_items WHERE challan_id = $1', [id]);
      for (const it of inputItems) {
        const amount = normalizeChallanItemAmount(it);
        await client.query(
          `INSERT INTO delivery_challan_items
             (challan_id, item_id, so_item_id, item_name, hsn_code, unit, quantity, unit_price, gst_rate, discount_amount, currency_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10)`,
          [
            id,
            it.item_id || null,
            it.so_item_id || null,
            it.item_name || it.name || 'Item',
            it.hsn_code || null,
            it.unit || null,
            amount.quantity,
            amount.unitPrice,
            amount.discountAmount,
            currencyCode,
          ],
        );
      }

      return challanRes.rows[0];
    });

    res.json(success(result));
  } catch (err: any) {
    const msg = err.message || 'Failed to update delivery challan';
    res.status(/not found|cannot|At least one/i.test(msg) ? 400 : 500).json(error(msg));
  }
}

export async function deleteDeliveryChallan(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const result = await query(
      `UPDATE delivery_challans
       SET is_deleted = true
       WHERE id = $1 AND company_id = $2 AND is_deleted = false AND status <> 'converted'
       RETURNING id`,
      [id, companyId],
    );
    if (!result.rows.length) {
      return res.status(400).json(error('Delivery challan not found or already converted'));
    }
    res.json(success({ id }));
  } catch (err: any) {
    res.status(500).json(error(err.message || 'Failed to delete delivery challan'));
  }
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
        `SELECT c.*,
                p.name AS party_name,
                p.gstin AS party_gstin,
                p.phone AS party_phone,
                p.email AS party_email,
                p.billing_address AS party_billing_address,
                p.shipping_address AS party_shipping_address,
                p.billing_state_code AS party_billing_state_code,
                p.state_code AS party_state_code
         FROM delivery_challans c
         LEFT JOIN parties p ON p.id = c.party_id
         WHERE c.id = $1 AND c.company_id = $2 AND c.is_deleted = false AND c.status != 'converted'`,
        [id, companyId],
      ),
      query(`SELECT * FROM delivery_challan_items WHERE challan_id = $1 ORDER BY created_at`, [id]),
    ]);

    if (!challanRes.rows.length) return res.status(404).json(error('Challan not found or already converted'));
    if (!itemsRes.rows.length) return res.status(400).json(error('Challan has no items to convert'));
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
      const companyRes = await client.query(
        `SELECT state_code, gstin, einvoice_enabled, einvoice_turnover_above_5cr
         FROM companies WHERE id = $1`,
        [companyId],
      );
      const company = companyRes.rows[0] || {};
      const companyStateCode = String(company.gstin || '').slice(0, 2) || String(company.state_code || '').slice(0, 2);
      const partyGstin = challan.party_gstin_snapshot || challan.party_gstin || null;
      const partyStateCode = String(partyGstin || '').slice(0, 2)
        || String(challan.party_billing_state_code || challan.party_state_code || '').slice(0, 2);
      const isInterstate = !!companyStateCode && !!partyStateCode && companyStateCode !== partyStateCode;
      const einvoiceStatus = company.einvoice_enabled && company.einvoice_turnover_above_5cr ? 'pending' : 'not_applicable';

      const totals = itemsRes.rows.reduce(
        (acc: any, it: any) => {
          const amount = normalizeChallanItemAmount(it);
          const gross = Math.round(amount.quantity * amount.unitPrice);
          const gstRate = amount.gstRate;
          const cgst = isInterstate ? 0 : Math.round(amount.gstAmount / 2);
          const sgst = isInterstate ? 0 : amount.gstAmount - cgst;
          const igst = isInterstate ? amount.gstAmount : 0;
          acc.subtotal += gross;
          acc.discount += amount.discountAmount;
          acc.taxable += amount.taxableAmount;
          acc.cgst += cgst;
          acc.sgst += sgst;
          acc.igst += igst;
          acc.total += amount.taxableAmount + amount.gstAmount;
          acc.hasGst = acc.hasGst || gstRate > 0;
          return acc;
        },
        { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, hasGst: false },
      );

      const invRes = await client.query(
        `INSERT INTO invoices
           (company_id, party_id, invoice_number, invoice_date, invoice_type, status, payment_mode,
           is_interstate, place_of_supply,
            currency_code,
            party_name_snapshot, party_gstin_snapshot, party_phone_snapshot, party_email_snapshot,
            billing_address_snapshot, shipping_address_snapshot,
            subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount,
            round_off, total_amount, paid_amount, payment_status, einvoice_status,
            notes, created_by)
         VALUES ($1,$2,$3,$4,'tax_invoice','confirmed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,0,$22,0,'unpaid',$23,$24,$25)
         RETURNING *`,
        [
          companyId, challan.party_id, invoiceNumber,
          d.invoice_date || new Date().toISOString().split('T')[0],
          d.payment_mode || 'credit',
          isInterstate,
          partyStateCode || null,
          normalizeCurrencyCode(challan.currency_code),
          challan.party_name_snapshot || challan.party_name || null,
          partyGstin,
          challan.party_phone || null,
          challan.party_email || null,
          challan.party_address_snapshot || challan.party_billing_address || null,
          challan.party_shipping_address || challan.party_address_snapshot || challan.party_billing_address || null,
          totals.subtotal,
          totals.discount,
          totals.taxable,
          totals.cgst,
          totals.sgst,
          totals.igst,
          0,
          totals.total,
          einvoiceStatus,
          challan.notes ? `${challan.notes}\nConverted from delivery challan ${challan.challan_number}` : `Converted from delivery challan ${challan.challan_number}`,
          req.user!.id,
        ],
      );
      const invoiceId = invRes.rows[0].id;

      // Insert invoice items
      for (let idx = 0; idx < itemsRes.rows.length; idx++) {
        const it = itemsRes.rows[idx];
        const amount = normalizeChallanItemAmount(it);
        const cgstAmount = isInterstate ? 0 : Math.round(amount.gstAmount / 2);
        const sgstAmount = isInterstate ? 0 : amount.gstAmount - cgstAmount;
        const igstAmount = isInterstate ? amount.gstAmount : 0;
        const halfRate = amount.gstRate / 2;
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id, company_id, item_id, item_name, hsn_code, unit, quantity, unit_price, currency_code, discount_amount, taxable_amount, gst_rate,
              cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            invoiceId, companyId, it.item_id || null, it.item_name || 'Item', it.hsn_code || null, it.unit || 'PCS',
            amount.quantity, amount.unitPrice, normalizeCurrencyCode(challan.currency_code), amount.discountAmount, amount.taxableAmount, amount.gstRate,
            isInterstate ? 0 : halfRate,
            isInterstate ? 0 : halfRate,
            isInterstate ? amount.gstRate : 0,
            cgstAmount,
            sgstAmount,
            igstAmount,
            amount.totalAmount,
          ],
        );
      }

      // Update party balance
      if (challan.party_id) {
        await client.query(
          `UPDATE parties SET balance = balance + $1 WHERE id = $2`,
          [totals.total, challan.party_id],
        );
        await client.query(
          `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
           SELECT $1, $2, 'debit', $3, balance, 'invoice', $4, 'Converted from challan ' || $5, $6
           FROM parties WHERE id = $2`,
          [companyId, challan.party_id, totals.total, invoiceId, challan.challan_number, req.user!.id],
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
