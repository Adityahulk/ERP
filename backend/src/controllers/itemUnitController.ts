import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { seedDefaultItemMasters } from '../services/onboardingService';

export async function listUnits(req: Request, res: Response) {
  try {
    await seedDefaultItemMasters(req.user!.company_id);
    const result = await query(
      `SELECT u.*,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', c.id,
                    'factor', c.factor,
                    'secondary_unit_id', su.id,
                    'secondary_unit_name', su.name,
                    'secondary_unit_abbreviation', su.abbreviation
                  )
                  ORDER BY su.name
                ) FILTER (WHERE c.id IS NOT NULL),
                '[]'::json
              ) AS conversions
       FROM item_units u
       LEFT JOIN item_unit_conversions c ON c.base_unit_id = u.id AND c.company_id = u.company_id
       LEFT JOIN item_units su ON su.id = c.secondary_unit_id AND su.company_id = u.company_id
       WHERE u.company_id = $1
       GROUP BY u.id
       ORDER BY u.is_default DESC, u.name`, [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createConversion(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { factor, secondary_unit_id } = req.body;
    const companyId = req.user!.company_id;
    const n = Number(factor);
    if (!secondary_unit_id || !Number.isFinite(n) || n <= 0) {
      return res.status(400).json(error('Select a secondary unit and enter a positive conversion rate'));
    }
    if (secondary_unit_id === id) return res.status(400).json(error('Secondary unit must be different from base unit'));

    const units = await query(
      `SELECT id FROM item_units WHERE company_id = $1 AND id IN ($2, $3)`,
      [companyId, id, secondary_unit_id],
    );
    if (units.rows.length !== 2) return res.status(404).json(error('Unit not found'));

    const result = await query(
      `INSERT INTO item_unit_conversions (company_id, base_unit_id, factor, secondary_unit_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, base_unit_id, secondary_unit_id)
       DO UPDATE SET factor = EXCLUDED.factor, updated_at = NOW()
       RETURNING *`,
      [companyId, id, n, secondary_unit_id],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function deleteConversion(req: Request, res: Response) {
  try {
    const result = await query(
      `DELETE FROM item_unit_conversions
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [req.params.conversionId, req.user!.company_id],
    );
    if (!result.rows.length) return res.status(404).json(error('Conversion not found'));
    res.json(success({ message: 'Conversion removed' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function createUnit(req: Request, res: Response) {
  try {
    const { name, abbreviation, is_default } = req.body;
    const cleanName = String(name || '').trim();
    const cleanAbbreviation = String(abbreviation || '').trim() || null;
    if (!cleanName) return res.status(400).json(error('Unit name is required'));
    const unit = await withTransaction(async (client) => {
      if (is_default) {
        await client.query('UPDATE item_units SET is_default = false WHERE company_id = $1', [req.user!.company_id]);
      }
      const result = await client.query(
        'INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user!.company_id, cleanName, cleanAbbreviation, is_default || false],
      );
      return result.rows[0];
    });
    res.status(201).json(success(unit));
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json(error('A unit with this name or abbreviation already exists'));
    res.status(500).json(error(err.message));
  }
}

export async function updateUnit(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (req.body.name !== undefined) {
      req.body.name = String(req.body.name || '').trim();
      if (!req.body.name) return res.status(400).json(error('Unit name is required'));
    }
    if (req.body.abbreviation !== undefined) {
      req.body.abbreviation = String(req.body.abbreviation || '').trim() || null;
    }
    const fields = ['name', 'abbreviation', 'is_default'];
    const updates: string[] = []; const values: any[] = []; let idx = 1;
    for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(req.body[f]); } }
    if (!updates.length) return res.status(400).json(error('No fields to update'));

    values.push(id, req.user!.company_id);
    const unit = await withTransaction(async (client) => {
      if (req.body.is_default) {
        await client.query('UPDATE item_units SET is_default = false WHERE company_id = $1', [req.user!.company_id]);
      }
      const result = await client.query(
        `UPDATE item_units SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values,
      );
      if (!result.rows.length) throw new Error('Unit not found');
      return result.rows[0];
    });
    res.json(success(unit));
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json(error('A unit with this name or abbreviation already exists'));
    if (/Unit not found/i.test(err?.message || '')) return res.status(404).json(error('Unit not found'));
    res.status(500).json(error(err.message));
  }
}
