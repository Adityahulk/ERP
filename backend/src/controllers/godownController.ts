import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';

// ── GET /api/godowns ──────────────────────────────────────────
export async function listGodowns(req: Request, res: Response) {
  try {
    const activeFilter = String(req.query.include_inactive || '').toLowerCase() === 'true' ? '' : ' AND g.is_active = true';
    const result = await query(
      `SELECT g.*, u.name as manager_name,
              (SELECT COUNT(*) FROM item_stock s WHERE s.godown_id = g.id AND s.quantity > 0) as item_count,
              (SELECT COALESCE(SUM(GREATEST(s.quantity, 0) * COALESCE(NULLIF(s.avg_cost_price, 0), si.purchase_price, 0)), 0)
               FROM item_stock s JOIN items si ON si.id = s.item_id WHERE s.godown_id = g.id) as stock_value,
              (SELECT COALESCE(SUM(ABS(LEAST(s.quantity, 0)) * COALESCE(NULLIF(s.avg_cost_price, 0), si.purchase_price, 0)), 0)
               FROM item_stock s JOIN items si ON si.id = s.item_id WHERE s.godown_id = g.id) as stock_shortfall_value
       FROM godowns g
       LEFT JOIN users u ON g.manager_id = u.id
       WHERE g.company_id = $1 AND g.is_deleted = false${activeFilter}
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
    const cleanName = String(name || '').trim();
    const cleanCode = String(code || '').trim();
    if (!cleanName) return res.status(400).json(error('Godown name is required'));

    const result = await withTransaction(async (client) => {
      await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
      const duplicate = await client.query(
        `SELECT id FROM godowns
         WHERE company_id = $1 AND is_deleted = false
           AND (LOWER(BTRIM(name)) = LOWER(BTRIM($2))
             OR ($3 <> '' AND LOWER(BTRIM(code)) = LOWER(BTRIM($3))))
         LIMIT 1`,
        [companyId, cleanName, cleanCode],
      );
      if (duplicate.rows.length) throw Object.assign(new Error('A godown with this name or code already exists in this company.'), { status: 409 });

      if (is_default) await client.query('UPDATE godowns SET is_default = false WHERE company_id = $1', [companyId]);
      const inserted = await client.query(
        `INSERT INTO godowns (company_id, name, code, address, city, state, pincode, gstin, phone, manager_id, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [companyId, cleanName, cleanCode || null, address, city, state, pincode, gstin, phone, manager_id, is_default || false],
      );
      return inserted.rows[0];
    });

    await logAction(req.user!.id, companyId, 'create', 'godown', result.id, null, result, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(err.status || 500).json(error(err.message)); }
}

// ── PATCH /api/godowns/:id ────────────────────────────────────
export async function updateGodown(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const fields = ['name','code','address','city','state','pincode','gstin','phone','manager_id','is_default','is_active'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (!updates.length) return res.status(400).json(error('No fields to update'));
    const cleanName = req.body.name === undefined ? undefined : String(req.body.name || '').trim();
    const cleanCode = req.body.code === undefined ? undefined : String(req.body.code || '').trim();
    if (cleanName !== undefined && !cleanName) return res.status(400).json(error('Godown name is required'));
    if (req.body.is_default === true && req.body.is_active === false) return res.status(400).json(error('An inactive godown cannot be the default'));

    const result = await withTransaction(async (client) => {
      await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
      const existing = await client.query(
        'SELECT * FROM godowns WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE', [id, companyId],
      );
      if (!existing.rows.length) throw Object.assign(new Error('Godown not found'), { status: 404 });
      const current = existing.rows[0];
      const nextName = cleanName ?? current.name;
      const nextCode = cleanCode ?? current.code ?? '';
      const duplicate = await client.query(
        `SELECT id FROM godowns
         WHERE company_id = $1 AND is_deleted = false AND id <> $2
           AND (LOWER(BTRIM(name)) = LOWER(BTRIM($3))
             OR ($4 <> '' AND LOWER(BTRIM(code)) = LOWER(BTRIM($4))))
         LIMIT 1`,
        [companyId, id, nextName, nextCode],
      );
      if (duplicate.rows.length) throw Object.assign(new Error('A godown with this name or code already exists in this company.'), { status: 409 });

      const disabling = req.body.is_active === false && current.is_active !== false;
      if (disabling && current.is_default) throw Object.assign(new Error('Set another active godown as default before disabling this one.'), { status: 400 });
      if (disabling) {
        const occupied = await client.query(
          `SELECT COUNT(*)::int AS count FROM item_stock
           WHERE company_id = $1 AND godown_id = $2
             AND (quantity <> 0 OR COALESCE(reserved_quantity, 0) <> 0)`,
          [companyId, id],
        );
        if (Number(occupied.rows[0]?.count || 0) > 0) {
          throw Object.assign(new Error('Transfer or adjust all stock and reservations to zero before disabling this godown.'), { status: 400 });
        }
      }

      if (req.body.is_default === true) await client.query('UPDATE godowns SET is_default = false WHERE company_id = $1', [companyId]);
      const updateValues: any[] = [];
      const assignments = fields.filter((field) => req.body[field] !== undefined).map((field) => {
        updateValues.push(field === 'name' ? cleanName : field === 'code' ? (cleanCode || null) : req.body[field]);
        return `${field} = $${updateValues.length}`;
      });
      updateValues.push(id, companyId);
      const updated = await client.query(
        `UPDATE godowns SET ${assignments.join(', ')} WHERE id = $${updateValues.length - 1} AND company_id = $${updateValues.length} RETURNING *`,
        updateValues,
      );
      return { before: current, after: updated.rows[0] };
    });

    await logAction(req.user!.id, companyId, 'update', 'godown', id, result.before, result.after, req.ip);
    res.json(success(result.after));
  } catch (err: any) { res.status(err.status || 500).json(error(err.message)); }
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
