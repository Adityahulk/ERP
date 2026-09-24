import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { generateSalesDocumentPDF } from '../services/pdfService';
import { isMailerConfigured, sendMail } from '../services/mailer';

async function nextSoNumber(companyId: string, client: any) {
  const yr = new Date().getFullYear().toString().slice(-2);
  const res = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM sale_orders WHERE company_id = $1 AND is_deleted = false`,
    [companyId],
  );
  const seq = String((res.rows[0].cnt || 0) + 1).padStart(4, '0');
  return `SO/${yr}/${seq}`;
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
        `SELECT o.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email
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
        `SELECT o.*, p.name AS party_name, p.phone AS party_phone, p.gstin AS party_gstin, p.billing_address AS party_address
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
      const soNumber = d.so_number?.trim() || await nextSoNumber(companyId, client);

      const partySnap = d.party_id
        ? await client.query(`SELECT name, gstin, billing_address FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };
      const party = partySnap.rows[0];

      const totalAmount = (d.items as any[]).reduce(
        (sum: number, item: any) => sum + Math.max(0, Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0))),
        0,
      );

      const orderRes = await client.query(
        `INSERT INTO sale_orders
           (company_id, party_id, so_number, so_date, expected_delivery_date, status,
            payment_terms, notes, total_amount, party_name_snapshot, party_gstin_snapshot,
            party_address_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          companyId, d.party_id || null, soNumber,
          d.so_date || new Date().toISOString().split('T')[0],
          d.expected_delivery_date || null,
          d.status || 'confirmed',
          d.payment_terms || null,
          d.notes || null,
          totalAmount,
          party?.name || d.party_name || null,
          party?.gstin || null,
          party?.billing_address || null,
          req.user!.id,
        ],
      );
      const orderId = orderRes.rows[0].id;

      for (const it of d.items as any[]) {
        await client.query(
          `INSERT INTO sale_order_items
             (order_id, item_id, item_name, hsn_code, unit, quantity_ordered, unit_price, gst_rate, discount_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [orderId, it.item_id || null, it.item_name || it.name, it.hsn_code || null,
           it.unit || null, it.quantity, it.unit_price, it.gst_rate || 0, it.discount_amount || 0],
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
        ? await client.query(`SELECT name, gstin, billing_address FROM parties WHERE id = $1 AND company_id = $2`, [d.party_id, companyId])
        : { rows: [] };
      const party = partySnap.rows[0];
      const totalAmount = (d.items as any[]).reduce(
        (sum: number, item: any) => sum + Math.max(0, Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0))),
        0,
      );
      const updated = await client.query(
        `UPDATE sale_orders SET
           party_id = $1, so_number = $2, so_date = $3, expected_delivery_date = $4,
           payment_terms = $5, notes = $6, total_amount = $7,
           party_name_snapshot = $8, party_gstin_snapshot = $9, party_address_snapshot = $10,
           updated_at = NOW()
         WHERE id = $11 AND company_id = $12 RETURNING *`,
        [
          d.party_id || null, String(d.so_number || existing.rows[0].so_number).trim(),
          d.so_date || existing.rows[0].so_date, d.expected_delivery_date || null,
          d.payment_terms || null, d.notes || null, totalAmount,
          party?.name || d.party_name || null, party?.gstin || null, party?.billing_address || null,
          id, companyId,
        ],
      );
      await client.query(`DELETE FROM sale_order_items WHERE order_id = $1`, [id]);
      for (const item of d.items as any[]) {
        await client.query(
          `INSERT INTO sale_order_items
             (order_id, item_id, item_name, hsn_code, unit, quantity_ordered, unit_price, gst_rate, discount_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, item.item_id || null, item.item_name || item.name || 'Item', item.hsn_code || null,
           item.unit || null, Number(item.quantity) || 0, Math.round(Number(item.unit_price) || 0),
           Number(item.gst_rate) || 0, Math.round(Number(item.discount_amount) || 0)],
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
      `SELECT o.*, p.name AS party_name, p.phone AS party_phone, p.email AS party_email,
              p.gstin AS party_gstin, p.billing_address AS party_address
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
