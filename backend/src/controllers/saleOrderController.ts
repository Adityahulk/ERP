import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';

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
        `SELECT o.*, p.name AS party_name, p.phone AS party_phone
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
        (s: number, it: any) => s + Math.round(it.quantity * it.unit_price), 0,
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
