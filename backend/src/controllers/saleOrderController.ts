import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { generateSalesDocumentPDF } from '../services/pdfService';
import { isMailerConfigured, sendMail } from '../services/mailer';

const DEFAULT_SALE_ORDER_TERMS = [
  'This Sales Order is subject to the agreed validity period.',
  'Prices exclude freight or other charges unless specifically mentioned.',
  'Changes in quantity or specifications may affect the order value.',
  'Payment terms are as stated in this order or the final invoice.',
  'Delivery dates are estimates unless expressly confirmed.',
].join('\n');

function trimOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function financialYearShort(date = new Date()) {
  const year = date.getFullYear();
  return date.getMonth() >= 3
    ? `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`
    : `${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
}

async function nextSoNumber(companyId: string, godownId: string | null, client: any) {
  const fy = financialYearShort();
  const existingResult = await client.query(
    `SELECT COALESCE(MAX((substring(so_number FROM '([0-9]+)$'))::bigint), 0)::bigint AS last_number
     FROM sale_orders
     WHERE company_id = $1 AND is_deleted = false AND so_number LIKE $2`,
    [companyId, `%/${fy}/%`],
  );
  const existingMax = Number(existingResult.rows[0]?.last_number || 0);
  const res = await client.query(
    `INSERT INTO document_sequences (company_id, document_type, financial_year, last_number)
     VALUES ($1, 'sale_order', $2, $3 + 1)
     ON CONFLICT (company_id, document_type, financial_year)
     DO UPDATE SET last_number = GREATEST(document_sequences.last_number, $3) + 1, updated_at = NOW()
     RETURNING last_number`,
    [companyId, fy, existingMax],
  );
  const seq = String(Number(res.rows[0]?.last_number) || 1).padStart(4, '0');
  return `SO/${godownId ? 'GW' : 'HQ'}/${fy}/${seq}`;
}

function calculateOrderLine(item: any, isInterstate: boolean) {
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const unitPrice = Math.max(0, Math.round(Number(item.unit_price) || 0));
  const subtotal = Math.max(0, Math.round(quantity * unitPrice));
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(item.discount_amount) || 0)));
  const taxable = subtotal - discount;
  const gstRate = Math.max(0, Math.min(100, Number(item.gst_rate) || 0));
  const tax = Math.round(taxable * gstRate / 100);
  const cgst = isInterstate ? 0 : Math.round(tax / 2);
  const sgst = isInterstate ? 0 : tax - cgst;
  const igst = isInterstate ? tax : 0;
  return {
    quantity, unitPrice, subtotal, discount, taxable, gstRate,
    cgstRate: isInterstate ? 0 : gstRate / 2,
    sgstRate: isInterstate ? 0 : gstRate / 2,
    igstRate: isInterstate ? gstRate : 0,
    cgst, sgst, igst, total: taxable + tax,
  };
}

function addDays(dateValue: unknown, days: number) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.min(365, days || 14)));
  return date.toISOString().slice(0, 10);
}

export async function listSaleOrders(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { status, search, limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions: string[] = ['o.company_id = $1', 'o.is_deleted = false'];
    const values: any[] = [companyId];
    let idx = 2;

    if (status) { conditions.push(`o.status = $${idx++}`); values.push(status); }
    if (search) {
      conditions.push(`(o.so_number ILIKE $${idx} OR o.party_name_snapshot ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }

    const where = conditions.join(' AND ');
    const [rows, countRes] = await Promise.all([
      query(
        `SELECT o.*, p.name AS party_name,
                COALESCE(o.party_phone_snapshot, p.phone) AS party_phone,
                COALESCE(o.party_email_snapshot, p.email) AS party_email
         FROM sale_orders o LEFT JOIN parties p ON p.id = o.party_id
         WHERE ${where} ORDER BY o.so_date DESC, o.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM sale_orders o WHERE ${where}`, values),
    ]);

    const total = countRes.rows[0].total;
    res.json(success({
      data: rows.rows,
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getSaleOrder(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const [orderRes, itemsRes] = await Promise.all([
      query(
        `SELECT o.*, p.name AS party_name,
                COALESCE(o.party_phone_snapshot, p.phone) AS party_phone,
                COALESCE(o.party_email_snapshot, p.email) AS party_email,
                COALESCE(o.party_gstin_snapshot, p.gstin, 'URP') AS party_gstin,
                COALESCE(o.party_address_snapshot, p.billing_address) AS party_address,
                COALESCE(o.party_state_snapshot, p.billing_state, p.state) AS party_state,
                COALESCE(o.party_state_code_snapshot, p.billing_state_code, p.state_code) AS party_state_code
         FROM sale_orders o LEFT JOIN parties p ON p.id = o.party_id
         WHERE o.id = $1 AND o.company_id = $2 AND o.is_deleted = false`,
        [id, companyId],
      ),
      query(`SELECT * FROM sale_order_items WHERE order_id = $1 ORDER BY created_at`, [id]),
    ]);
    if (!orderRes.rows.length) return res.status(404).json(error('Sale order not found'));
    res.json(success({ ...orderRes.rows[0], items: itemsRes.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createSaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.items?.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const companyRes = await client.query(
        `SELECT state_code, sale_order_delivery_days, sale_order_terms_template, terms_and_conditions
         FROM companies WHERE id = $1 AND is_deleted = false`,
        [companyId],
      );
      const company = companyRes.rows[0] || {};
      const godownId = trimOrNull(d.godown_id);
      const soNumber = trimOrNull(d.so_number) || await nextSoNumber(companyId, godownId, client);
      const orderDate = trimOrNull(d.so_date) || new Date().toISOString().slice(0, 10);

      const partySnap = d.party_id
        ? await client.query(
          `SELECT name, phone, email, gstin, billing_address, billing_city, billing_state,
                  billing_pincode, billing_state_code, shipping_address, shipping_city,
                  shipping_state, shipping_pincode, state, state_code
           FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId],
        )
        : { rows: [] };
      const party = partySnap.rows[0];
      if (!party) throw new Error('Select a valid party');

      const buyerStateCode = trimOrNull(d.billing_state_code) || trimOrNull(party.billing_state_code) || trimOrNull(party.state_code);
      const sellerStateCode = trimOrNull(company.state_code);
      const isInterstate = d.is_interstate === undefined
        ? Boolean(buyerStateCode && sellerStateCode && buyerStateCode.slice(0, 2) !== sellerStateCode.slice(0, 2))
        : Boolean(d.is_interstate);
      const prepared = (d.items as any[]).map((item) => ({ item, totals: calculateOrderLine(item, isInterstate) }));
      const sums = prepared.reduce((acc, row) => {
        acc.subtotal += row.totals.subtotal;
        acc.discount += row.totals.discount;
        acc.taxable += row.totals.taxable;
        acc.cgst += row.totals.cgst;
        acc.sgst += row.totals.sgst;
        acc.igst += row.totals.igst;
        acc.total += row.totals.total;
        return acc;
      }, { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });

      const sameAsBilling = d.shipping_same_as_billing !== false;
      const billingName = trimOrNull(d.billing_recipient_name) || trimOrNull(party.name);
      const billingAddress = trimOrNull(d.billing_address) || trimOrNull(party.billing_address);
      const billingCity = trimOrNull(d.billing_city) || trimOrNull(party.billing_city);
      const billingState = trimOrNull(d.billing_state) || trimOrNull(party.billing_state) || trimOrNull(party.state);
      const billingPincode = trimOrNull(d.billing_pincode) || trimOrNull(party.billing_pincode);
      const shippingName = sameAsBilling ? billingName : trimOrNull(d.shipping_recipient_name) || trimOrNull(party.name);
      const shippingAddress = sameAsBilling ? billingAddress : trimOrNull(d.shipping_address) || trimOrNull(party.shipping_address) || billingAddress;
      const shippingCity = sameAsBilling ? billingCity : trimOrNull(d.shipping_city) || trimOrNull(party.shipping_city) || billingCity;
      const shippingState = sameAsBilling ? billingState : trimOrNull(d.shipping_state) || trimOrNull(party.shipping_state) || billingState;
      const shippingPincode = sameAsBilling ? billingPincode : trimOrNull(d.shipping_pincode) || trimOrNull(party.shipping_pincode) || billingPincode;

      const orderRes = await client.query(
        `INSERT INTO sale_orders
           (company_id, godown_id, party_id, so_number, so_date, expected_delivery_date, status,
            payment_terms, delivery_terms, customer_notes, notes, terms_and_conditions, is_interstate,
            subtotal_amount, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
            party_name_snapshot, party_phone_snapshot, party_email_snapshot, party_gstin_snapshot,
            party_address_snapshot, party_state_snapshot, party_state_code_snapshot,
            billing_recipient_name, billing_address, billing_city, billing_state, billing_state_code, billing_pincode, billing_country,
            shipping_same_as_billing, shipping_recipient_name, shipping_address, shipping_city, shipping_state,
            shipping_state_code, shipping_pincode, shipping_country, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43) RETURNING *`,
        [
          companyId, godownId, d.party_id, soNumber, orderDate,
          trimOrNull(d.expected_delivery_date) || addDays(orderDate, Number(company.sale_order_delivery_days) || 14),
          d.status || 'confirmed',
          trimOrNull(d.payment_terms), trimOrNull(d.delivery_terms), trimOrNull(d.customer_notes), trimOrNull(d.notes),
          trimOrNull(d.terms_and_conditions) || trimOrNull(company.sale_order_terms_template) || trimOrNull(company.terms_and_conditions) || DEFAULT_SALE_ORDER_TERMS,
          isInterstate, sums.subtotal, sums.discount, sums.taxable, sums.cgst, sums.sgst, sums.igst, sums.total,
          trimOrNull(d.party_name) || trimOrNull(party.name), trimOrNull(party.phone), trimOrNull(party.email), trimOrNull(party.gstin),
          billingAddress, billingState, buyerStateCode,
          billingName, billingAddress, billingCity, billingState, buyerStateCode, billingPincode, trimOrNull(d.billing_country) || 'India',
          sameAsBilling, shippingName, shippingAddress, shippingCity, shippingState,
          sameAsBilling ? buyerStateCode : trimOrNull(d.shipping_state_code) || buyerStateCode,
          shippingPincode, trimOrNull(d.shipping_country) || 'India',
          req.user!.id,
        ],
      );
      const orderId = orderRes.rows[0].id;

      for (const { item: it, totals } of prepared) {
        await client.query(
          `INSERT INTO sale_order_items
             (order_id, item_id, item_name, item_description, hsn_code, unit, quantity_ordered,
              unit_price, gst_rate, discount_amount, taxable_amount, cgst_rate, sgst_rate, igst_rate,
              cgst_amount, sgst_amount, igst_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [orderId, it.item_id || null, it.item_name || it.name || 'Item', trimOrNull(it.item_description || it.description),
           trimOrNull(it.hsn_code), trimOrNull(it.unit), totals.quantity, totals.unitPrice, totals.gstRate,
           totals.discount, totals.taxable, totals.cgstRate, totals.sgstRate, totals.igstRate,
           totals.cgst, totals.sgst, totals.igst, totals.total],
        );
      }
      return orderRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateSaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const d = req.body;
    if (!d.items?.length) return res.status(400).json(error('At least one item required'));

    const result = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM sale_orders WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE`,
        [id, companyId],
      );
      if (!existing.rows.length) throw new Error('Sale order not found');
      if (['fulfilled', 'cancelled'].includes(existing.rows[0].status)) throw new Error('A fulfilled or cancelled sale order cannot be edited');

      const partySnap = d.party_id
        ? await client.query(
          `SELECT name, phone, email, gstin, billing_address, billing_city, billing_state,
                  billing_pincode, billing_state_code, shipping_address, shipping_city,
                  shipping_state, shipping_pincode, state, state_code
           FROM parties WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
          [d.party_id, companyId],
        )
        : { rows: [] };
      const party = partySnap.rows[0];
      if (!party) throw new Error('Select a valid party');
      const company = (await client.query(`SELECT state_code FROM companies WHERE id = $1`, [companyId])).rows[0] || {};
      const buyerStateCode = trimOrNull(d.billing_state_code) || trimOrNull(party.billing_state_code) || trimOrNull(party.state_code);
      const sellerStateCode = trimOrNull(company.state_code);
      const isInterstate = d.is_interstate === undefined
        ? Boolean(buyerStateCode && sellerStateCode && buyerStateCode.slice(0, 2) !== sellerStateCode.slice(0, 2))
        : Boolean(d.is_interstate);
      const prepared = (d.items as any[]).map((item) => ({ item, totals: calculateOrderLine(item, isInterstate) }));
      const sums = prepared.reduce((acc, row) => {
        acc.subtotal += row.totals.subtotal; acc.discount += row.totals.discount;
        acc.taxable += row.totals.taxable; acc.cgst += row.totals.cgst;
        acc.sgst += row.totals.sgst; acc.igst += row.totals.igst; acc.total += row.totals.total;
        return acc;
      }, { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
      const sameAsBilling = d.shipping_same_as_billing !== false;
      const billingName = trimOrNull(d.billing_recipient_name) || trimOrNull(party.name);
      const billingAddress = trimOrNull(d.billing_address) || trimOrNull(party.billing_address);
      const billingCity = trimOrNull(d.billing_city) || trimOrNull(party.billing_city);
      const billingState = trimOrNull(d.billing_state) || trimOrNull(party.billing_state) || trimOrNull(party.state);
      const billingPincode = trimOrNull(d.billing_pincode) || trimOrNull(party.billing_pincode);
      const shippingName = sameAsBilling ? billingName : trimOrNull(d.shipping_recipient_name) || trimOrNull(party.name);
      const shippingAddress = sameAsBilling ? billingAddress : trimOrNull(d.shipping_address) || trimOrNull(party.shipping_address) || billingAddress;
      const shippingCity = sameAsBilling ? billingCity : trimOrNull(d.shipping_city) || trimOrNull(party.shipping_city) || billingCity;
      const shippingState = sameAsBilling ? billingState : trimOrNull(d.shipping_state) || trimOrNull(party.shipping_state) || billingState;
      const shippingPincode = sameAsBilling ? billingPincode : trimOrNull(d.shipping_pincode) || trimOrNull(party.shipping_pincode) || billingPincode;
      const updated = await client.query(
        `UPDATE sale_orders SET
           godown_id=$1, party_id=$2, so_number=$3, so_date=$4, expected_delivery_date=$5,
           payment_terms=$6, delivery_terms=$7, customer_notes=$8, notes=$9, terms_and_conditions=$10,
           is_interstate=$11, subtotal_amount=$12, discount_amount=$13, taxable_amount=$14,
           cgst_amount=$15, sgst_amount=$16, igst_amount=$17, total_amount=$18,
           party_name_snapshot=$19, party_phone_snapshot=$20, party_email_snapshot=$21,
           party_gstin_snapshot=$22, party_address_snapshot=$23, party_state_snapshot=$24,
           party_state_code_snapshot=$25, billing_recipient_name=$26, billing_address=$27,
           billing_city=$28, billing_state=$29, billing_state_code=$30, billing_pincode=$31,
           billing_country=$32, shipping_same_as_billing=$33, shipping_recipient_name=$34,
           shipping_address=$35, shipping_city=$36, shipping_state=$37, shipping_state_code=$38,
           shipping_pincode=$39, shipping_country=$40, updated_at=NOW()
         WHERE id=$41 AND company_id=$42 RETURNING *`,
        [
          trimOrNull(d.godown_id), d.party_id, String(d.so_number || existing.rows[0].so_number).trim(),
          d.so_date || existing.rows[0].so_date, trimOrNull(d.expected_delivery_date),
          trimOrNull(d.payment_terms), trimOrNull(d.delivery_terms), trimOrNull(d.customer_notes),
          trimOrNull(d.notes), trimOrNull(d.terms_and_conditions) || existing.rows[0].terms_and_conditions,
          isInterstate, sums.subtotal, sums.discount, sums.taxable, sums.cgst, sums.sgst, sums.igst, sums.total,
          trimOrNull(d.party_name) || trimOrNull(party.name), trimOrNull(party.phone), trimOrNull(party.email),
          trimOrNull(party.gstin), billingAddress, billingState, buyerStateCode,
          billingName, billingAddress, billingCity, billingState, buyerStateCode, billingPincode,
          trimOrNull(d.billing_country) || 'India', sameAsBilling, shippingName, shippingAddress,
          shippingCity, shippingState, sameAsBilling ? buyerStateCode : trimOrNull(d.shipping_state_code) || buyerStateCode,
          shippingPincode, trimOrNull(d.shipping_country) || 'India',
          id, companyId,
        ],
      );
      await client.query(`DELETE FROM sale_order_items WHERE order_id = $1`, [id]);
      for (const { item, totals } of prepared) {
        await client.query(
          `INSERT INTO sale_order_items
             (order_id, item_id, item_name, item_description, hsn_code, unit, quantity_ordered,
              unit_price, gst_rate, discount_amount, taxable_amount, cgst_rate, sgst_rate, igst_rate,
              cgst_amount, sgst_amount, igst_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [id, item.item_id || null, item.item_name || item.name || 'Item', trimOrNull(item.item_description || item.description),
           trimOrNull(item.hsn_code), trimOrNull(item.unit), totals.quantity, totals.unitPrice, totals.gstRate,
           totals.discount, totals.taxable, totals.cgstRate, totals.sgstRate, totals.igstRate,
           totals.cgst, totals.sgst, totals.igst, totals.total],
        );
      }
      return updated.rows[0];
    });
    res.json(success(result));
  } catch (err: any) {
    const message = err?.message || 'Failed to update sale order';
    res.status(/not found|cannot|required/i.test(message) ? 400 : 500).json(error(message));
  }
}

async function loadSaleOrderDocument(id: string, companyId: string) {
  const [orderRes, itemsRes, companyRes] = await Promise.all([
    query(
      `SELECT o.*, p.name AS party_name,
              COALESCE(o.party_phone_snapshot, p.phone) AS party_phone,
              COALESCE(o.party_email_snapshot, p.email) AS party_email,
              COALESCE(o.party_gstin_snapshot, p.gstin, 'URP') AS party_gstin,
              COALESCE(o.party_address_snapshot, p.billing_address) AS party_address,
              COALESCE(o.party_state_snapshot, p.billing_state, p.state) AS party_state,
              COALESCE(o.party_state_code_snapshot, p.billing_state_code, p.state_code) AS party_state_code
       FROM sale_orders o
       LEFT JOIN parties p ON p.id = o.party_id AND p.company_id = o.company_id
       WHERE o.id = $1 AND o.company_id = $2 AND o.is_deleted = false`,
      [id, companyId],
    ),
    query(`SELECT * FROM sale_order_items WHERE order_id = $1 ORDER BY created_at, id`, [id]),
    query(`SELECT * FROM companies WHERE id = $1 AND is_deleted = false`, [companyId]),
  ]);
  if (!orderRes.rows.length) throw Object.assign(new Error('Sale order not found'), { status: 404 });
  if (!companyRes.rows.length) throw Object.assign(new Error('Company not found'), { status: 404 });
  const order = orderRes.rows[0];
  const party = order.party_id ? (await query(`SELECT * FROM parties WHERE id = $1 AND company_id = $2`, [order.party_id, companyId])).rows[0] : null;
  return { order, items: itemsRes.rows, company: companyRes.rows[0], party };
}

export async function getSaleOrderPDF(req: Request, res: Response) {
  try {
    const loaded = await loadSaleOrderDocument(req.params.id, req.user!.company_id);
    const pdf = await generateSalesDocumentPDF('sale_order', loaded.order, loaded.company, loaded.party, loaded.items);
    const filename = `${String(loaded.order.so_number || 'sale-order').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${String(req.query.inline || '') === '1' ? 'inline' : 'attachment'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to generate sale order PDF'));
  }
}

export async function emailSaleOrder(req: Request, res: Response) {
  try {
    if (!isMailerConfigured()) return res.status(503).json(error('Email delivery is not configured on this server.'));
    const recipient = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return res.status(400).json(error('Enter a valid email address'));
    const loaded = await loadSaleOrderDocument(req.params.id, req.user!.company_id);
    const pdf = await generateSalesDocumentPDF('sale_order', loaded.order, loaded.company, loaded.party, loaded.items);
    const safeNumber = String(loaded.order.so_number || 'sale-order').replace(/[^A-Za-z0-9._-]+/g, '-');
    const sent = await sendMail({
      to: recipient,
      subject: `Sale Order ${loaded.order.so_number} from ${loaded.company.name}`,
      html: `<p>Please find sale order <strong>${loaded.order.so_number}</strong> attached.</p><p>Thank you,<br>${loaded.company.name}</p>`,
      text: `Please find sale order ${loaded.order.so_number} attached.`,
      attachments: [{ filename: `${safeNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    if (!sent.delivered) return res.status(502).json(error(sent.reason || 'Email delivery failed'));
    res.json(success({ delivered: true, recipient }));
  } catch (err: any) {
    res.status(err?.status || 500).json(error(err?.message || 'Failed to email sale order'));
  }
}

export async function deleteSaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const linked = await query(
      `SELECT 1 FROM delivery_challans WHERE so_id = $1 AND company_id = $2 AND is_deleted = false LIMIT 1`,
      [req.params.id, companyId],
    );
    if (linked.rows.length) return res.status(400).json(error('This sale order has linked delivery challans and cannot be deleted. Cancel it instead.'));
    const deleted = await query(
      `UPDATE sale_orders SET is_deleted = true, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND is_deleted = false RETURNING id`,
      [req.params.id, companyId],
    );
    if (!deleted.rows.length) return res.status(404).json(error('Sale order not found'));
    res.json(success({ id: req.params.id }));
  } catch (err: any) {
    res.status(500).json(error(err?.message || 'Failed to delete sale order'));
  }
}

export async function updateSaleOrderStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const companyId = req.user!.company_id;
    const allowed = ['draft', 'confirmed', 'partial', 'fulfilled', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json(error('Invalid status'));
    const r = await query(
      `UPDATE sale_orders SET status = $1 WHERE id = $2 AND company_id = $3 AND is_deleted = false RETURNING *`,
      [status, id, companyId],
    );
    if (!r.rows.length) return res.status(404).json(error('Not found'));
    res.json(success(r.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
