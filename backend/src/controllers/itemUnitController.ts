import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

export async function listUnits(req: Request, res: Response) {
  try {
    const result = await query(
      'SELECT * FROM item_units WHERE company_id = $1 ORDER BY is_default DESC, name', [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createUnit(req: Request, res: Response) {
  try {
    const { name, abbreviation, is_default } = req.body;
    if (is_default) {
      await query('UPDATE item_units SET is_default = false WHERE company_id = $1', [req.user!.company_id]);
    }
    const result = await query(
      'INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user!.company_id, name, abbreviation, is_default || false]
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function updateUnit(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const fields = ['name', 'abbreviation', 'is_default'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (!updates.length) return res.status(400).json(error('No fields to update'));

    if (req.body.is_default) {
      await query('UPDATE item_units SET is_default = false WHERE company_id = $1', [req.user!.company_id]);
    }

    values.push(id, req.user!.company_id);
    const result = await query(
      `UPDATE item_units SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values
    );
    if (!result.rows.length) return res.status(404).json(error('Unit not found'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
