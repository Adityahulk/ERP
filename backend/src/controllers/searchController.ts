import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

const ILIKE = (q: string) => `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

export async function globalSearch(req: Request, res: Response) {
  try {
    const raw = String(req.query.q || '').trim();
    if (raw.length < 2) {
      return res.status(400).json(error('Query must be at least 2 characters'));
    }
    const companyId = req.user!.company_id;
    const pattern = ILIKE(raw);
    const limit = Math.min(Number(req.query.limit) || 8, 20);

    const [inv, parties, items] = await Promise.all([
      query(
        `SELECT id, invoice_number, invoice_date::text, status, total_amount
         FROM invoices
         WHERE company_id = $1 AND is_deleted = false
           AND (invoice_number ILIKE $2 OR party_name_snapshot ILIKE $2)
         ORDER BY invoice_date DESC, created_at DESC
         LIMIT $3`,
        [companyId, pattern, limit],
      ),
      query(
        `SELECT id, name, phone, gstin, party_type
         FROM parties
         WHERE company_id = $1 AND is_deleted = false
           AND (name ILIKE $2 OR COALESCE(phone,'') ILIKE $2 OR COALESCE(gstin,'') ILIKE $2 OR COALESCE(display_name,'') ILIKE $2)
         ORDER BY name ASC
         LIMIT $3`,
        [companyId, pattern, limit],
      ),
      query(
        `SELECT id, name, sku, hsn_code, selling_price
         FROM items
         WHERE company_id = $1 AND is_deleted = false AND is_active = true
           AND (name ILIKE $2 OR COALESCE(sku,'') ILIKE $2 OR COALESCE(hsn_code,'') ILIKE $2 OR COALESCE(barcode,'') ILIKE $2)
         ORDER BY name ASC
         LIMIT $3`,
        [companyId, pattern, limit],
      ),
    ]);

    res.json(
      success({
        invoices: inv.rows,
        parties: parties.rows,
        items: items.rows,
      }),
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
