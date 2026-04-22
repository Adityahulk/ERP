import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLog';

// ── GET /api/item-categories ──────────────────────────────────
export async function listCategories(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT c.*, p.name as parent_name,
              (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id AND i.is_deleted = false) as item_count
       FROM item_categories c
       LEFT JOIN item_categories p ON c.parent_id = p.id
       WHERE c.company_id = $1 AND c.is_deleted = false
       ORDER BY c.name`,
      [req.user!.company_id]
    );

    // Build hierarchical tree
    const map = new Map<string, any>();
    const roots: any[] = [];
    for (const cat of result.rows) { cat.children = []; map.set(cat.id, cat); }
    for (const cat of result.rows) {
      if (cat.parent_id && map.has(cat.parent_id)) map.get(cat.parent_id).children.push(cat);
      else roots.push(cat);
    }

    res.json(success({ categories: roots, flat: result.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/item-categories ─────────────────────────────────
export async function createCategory(req: Request, res: Response) {
  try {
    const { name, parent_id, description } = req.body;
    const result = await query(
      `INSERT INTO item_categories (company_id, name, parent_id, description) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user!.company_id, name, parent_id || null, description]
    );
    await logAction(req.user!.id, req.user!.company_id, 'create', 'item_category', result.rows[0].id);
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/item-categories/:id ────────────────────────────
export async function updateCategory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const fields = ['name','parent_id','description','is_active'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, req.user!.company_id);
    const result = await query(
      `UPDATE item_categories SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} AND is_deleted = false RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json(error('Category not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── DELETE /api/item-categories/:id ───────────────────────────
export async function deleteCategory(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const childCheck = await query(
      'SELECT COUNT(*) as cnt FROM items WHERE category_id = $1 AND is_deleted = false', [id]
    );
    if (parseInt(childCheck.rows[0].cnt) > 0) {
      return res.status(400).json(error('Cannot delete category with active items. Reassign items first.'));
    }

    const result = await query(
      'UPDATE item_categories SET is_deleted = true WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(404).json(error('Category not found'));
    res.json(success({ message: 'Category deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
