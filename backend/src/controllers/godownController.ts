import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';

// ── GET /api/godowns ──────────────────────────────────────────
export async function listGodowns(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT g.*, u.name as manager_name,
              (SELECT COUNT(*) FROM item_stock s WHERE s.godown_id = g.id AND s.quantity > 0) as item_count,
              (SELECT COALESCE(SUM(s.quantity * s.avg_cost_price), 0) FROM item_stock s WHERE s.godown_id = g.id) as stock_value
       FROM godowns g
       LEFT JOIN users u ON g.manager_id = u.id
       WHERE g.company_id = $1 AND g.is_deleted = false
       ORDER BY g.is_default DESC, g.name`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/godowns ─────────────────────────────────────────
export async function createGodown(req: Request, res: Response) {
  try {
    const { name, code, address, city, state, pincode, gstin, phone, manager_id, is_default } = req.body;
    const companyId = req.user!.company_id;

    if (is_default) {
      await query('UPDATE godowns SET is_default = false WHERE company_id = $1', [companyId]);
    }

    const result = await query(
      `INSERT INTO godowns (company_id, name, code, address, city, state, pincode, gstin, phone, manager_id, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [companyId, name, code, address, city, state, pincode, gstin, phone, manager_id, is_default || false]
    );

    await logAction(req.user!.id, companyId, 'create', 'godown', result.rows[0].id, null, result.rows[0], req.ip);
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/godowns/:id ────────────────────────────────────
export async function updateGodown(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const existing = await query(
      'SELECT * FROM godowns WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]
    );
    if (!existing.rows.length) return res.status(404).json(error('Godown not found'));

    if (req.body.is_default) {
      await query('UPDATE godowns SET is_default = false WHERE company_id = $1', [companyId]);
    }

    const fields = ['name','code','address','city','state','pincode','gstin','phone','manager_id','is_default','is_active'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, companyId);
    const result = await query(
      `UPDATE godowns SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values
    );

    await logAction(req.user!.id, companyId, 'update', 'godown', id, existing.rows[0], result.rows[0], req.ip);
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/godowns/:id ───────────────────────────────────
export async function deleteGodown(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const stockCheck = await query(
      'SELECT COUNT(*) as cnt FROM item_stock WHERE godown_id = $1 AND quantity > 0', [id]
    );
    if (parseInt(stockCheck.rows[0].cnt) > 0) {
      return res.status(400).json(error('Cannot delete godown with active stock. Transfer stock first.'));
    }

    const result = await query(
      'UPDATE godowns SET is_deleted = true WHERE id = $1 AND company_id = $2 AND is_default = false RETURNING id',
      [id, companyId]
    );

    if (!result.rows.length) return res.status(400).json(error('Cannot delete default godown'));

    await logAction(req.user!.id, companyId, 'delete', 'godown', id, null, null, req.ip);
    res.json(success({ message: 'Godown deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
