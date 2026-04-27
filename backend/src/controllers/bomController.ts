import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

// ── POST /api/bom ─────────────────────────────────────────────
export async function createBOM(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const d = req.body;
    if (!d.finished_item_id) return res.status(400).json(error('Finished item is required'));
    if (!Array.isArray(d.items) || d.items.length === 0) return res.status(400).json(error('At least one raw material is required'));

    const result = await withTransaction(async (client) => {
      const itemRes = await client.query(
        'SELECT id, name, item_type FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false',
        [d.finished_item_id, companyId]
      );
      if (!itemRes.rows.length) throw new Error('Finished item not found');

      const countRes = await client.query('SELECT COUNT(*)::int as count FROM bom WHERE company_id = $1', [companyId]);
      const bomNumber = `BOM-${String((countRes.rows[0]?.count || 0) + 1).padStart(4, '0')}`;

      let totalMaterialCost = 0;
      for (const item of d.items) {
        const matRes = await client.query(
          'SELECT purchase_price FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false',
          [item.item_id, companyId]
        );
        if (!matRes.rows.length) throw new Error(`Raw material not found: ${item.item_id}`);
        const unitCost = matRes.rows[0].purchase_price || 0;
        const qty = Number(item.quantity) || 0;
        const wastage = Number(item.wastage_percent) || 0;
        totalMaterialCost += Math.round(unitCost * qty * (1 + wastage / 100));
      }

      const labourCost = Math.round(Number(d.labour_cost) || 0);
      const overheadCost = Math.round(Number(d.overhead_cost) || 0);
      const totalCost = totalMaterialCost + labourCost + overheadCost;

      const bomRes = await client.query(
        `INSERT INTO bom (company_id, finished_item_id, bom_name, bom_number, version, labour_cost, overhead_cost, total_cost, notes, is_default, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [companyId, d.finished_item_id, d.bom_name || itemRes.rows[0].name + ' BOM', bomNumber, d.version || 1,
         labourCost, overheadCost, totalCost, d.notes || null, d.is_default || false, req.user!.id]
      );
      const bom = bomRes.rows[0];

      for (let i = 0; i < d.items.length; i++) {
        const item = d.items[i];
        const matRes = await client.query('SELECT name, purchase_price FROM items WHERE id = $1 AND company_id = $2', [item.item_id, companyId]);
        await client.query(
          `INSERT INTO bom_items (bom_id, item_id, item_name, quantity, unit, wastage_percent, unit_cost, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [bom.id, item.item_id, item.item_name || matRes.rows[0]?.name || 'Material', item.quantity,
           item.unit || 'PCS', item.wastage_percent || 0, matRes.rows[0]?.purchase_price || 0, item.notes || null, i + 1]
        );
      }
      return bom;
    });

    await logAction(req.user!.id, companyId, 'create', 'bom', result.id);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(/not found/i.test(err?.message) ? 404 : 400).json(error(err.message)); }
}

// ── GET /api/bom ──────────────────────────────────────────────
export async function listBOMs(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search } = req.query;
    let where = 'b.company_id = $1 AND b.is_deleted = false';
    const params: any[] = [companyId]; let idx = 2;
    if (search) { where += ` AND (b.bom_name ILIKE $${idx} OR b.bom_number ILIKE $${idx} OR fi.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM bom b LEFT JOIN items fi ON b.finished_item_id = fi.id WHERE ${where}`, params);
    const result = await query(
      `SELECT b.*, fi.name as finished_item_name, fi.sku as finished_item_sku,
              (SELECT COUNT(*)::int FROM bom_items bi WHERE bi.bom_id = b.id) as component_count
       FROM bom b LEFT JOIN items fi ON b.finished_item_id = fi.id
       WHERE ${where} ORDER BY b.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/bom/:id ──────────────────────────────────────────
export async function getBOM(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const bomRes = await query(
      `SELECT b.*, fi.name as finished_item_name, fi.sku as finished_item_sku
       FROM bom b LEFT JOIN items fi ON b.finished_item_id = fi.id
       WHERE b.id = $1 AND b.company_id = $2 AND b.is_deleted = false`, [req.params.id, companyId]
    );
    if (!bomRes.rows.length) return res.status(404).json(error('BOM not found'));

    const itemsRes = await query(
      `SELECT bi.*, i.sku as item_sku, i.purchase_price as current_cost, u.abbreviation as unit_abbr
       FROM bom_items bi LEFT JOIN items i ON bi.item_id = i.id LEFT JOIN item_units u ON i.unit_id = u.id
       WHERE bi.bom_id = $1 ORDER BY bi.sort_order, bi.id`, [req.params.id]
    );
    const logsRes = await query(
      `SELECT pl.*, g.name as godown_name, usr.name as created_by_name
       FROM production_logs pl LEFT JOIN godowns g ON pl.godown_id = g.id LEFT JOIN users usr ON pl.created_by = usr.id
       WHERE pl.bom_id = $1 AND pl.company_id = $2 AND pl.is_deleted = false
       ORDER BY pl.production_date DESC LIMIT 20`, [req.params.id, companyId]
    );
    res.json(success({ ...bomRes.rows[0], items: itemsRes.rows, production_logs: logsRes.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/bom/:id ────────────────────────────────────────
export async function updateBOM(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const bomId = req.params.id; const d = req.body;
    const result = await withTransaction(async (client) => {
      const existing = await client.query('SELECT id FROM bom WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE', [bomId, companyId]);
      if (!existing.rows.length) throw new Error('BOM not found');

      if (Array.isArray(d.items)) {
        let totalMaterialCost = 0;
        await client.query('DELETE FROM bom_items WHERE bom_id = $1', [bomId]);
        for (let i = 0; i < d.items.length; i++) {
          const item = d.items[i];
          const matRes = await client.query('SELECT name, purchase_price FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false', [item.item_id, companyId]);
          if (!matRes.rows.length) throw new Error('Material item not found');
          const unitCost = matRes.rows[0].purchase_price || 0;
          totalMaterialCost += Math.round(unitCost * Number(item.quantity) * (1 + (Number(item.wastage_percent) || 0) / 100));
          await client.query(
            `INSERT INTO bom_items (bom_id, item_id, item_name, quantity, unit, wastage_percent, unit_cost, notes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [bomId, item.item_id, item.item_name || matRes.rows[0].name, item.quantity, item.unit || 'PCS', item.wastage_percent || 0, unitCost, item.notes || null, i + 1]
          );
        }
        d.total_cost = totalMaterialCost + Math.round(Number(d.labour_cost) || 0) + Math.round(Number(d.overhead_cost) || 0);
      }

      const fields = ['bom_name', 'version', 'labour_cost', 'overhead_cost', 'total_cost', 'notes', 'is_default', 'is_active'];
      const updates: string[] = []; const values: any[] = []; let idx = 1;
      for (const f of fields) { if (d[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(d[f]); } }
      if (updates.length) { values.push(bomId, companyId); await client.query(`UPDATE bom SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx}`, values); }
      return (await client.query('SELECT b.*, fi.name as finished_item_name FROM bom b LEFT JOIN items fi ON b.finished_item_id = fi.id WHERE b.id = $1', [bomId])).rows[0];
    });
    res.json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── DELETE /api/bom/:id ───────────────────────────────────────
export async function deleteBOM(req: Request, res: Response) {
  try {
    const result = await query('UPDATE bom SET is_deleted = true WHERE id = $1 AND company_id = $2 RETURNING id', [req.params.id, req.user!.company_id]);
    if (!result.rows.length) return res.status(404).json(error('BOM not found'));
    res.json(success({ message: 'BOM deleted' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/bom/:id/produce ─────────────────────────────────
export async function produceBOM(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const bomId = req.params.id; const d = req.body;
    const qtyToProduce = Number(d.quantity) || 0;
    if (qtyToProduce <= 0) return res.status(400).json(error('Quantity must be positive'));

    const result = await withTransaction(async (client) => {
      const bomRes = await client.query(
        `SELECT b.*, fi.name as finished_item_name, fi.track_inventory FROM bom b LEFT JOIN items fi ON b.finished_item_id = fi.id
         WHERE b.id = $1 AND b.company_id = $2 AND b.is_deleted = false`, [bomId, companyId]
      );
      if (!bomRes.rows.length) throw new Error('BOM not found');
      const bom = bomRes.rows[0];
      const godownId = d.godown_id || req.user!.godown_id;
      if (!godownId) throw new Error('Godown is required for production');

      const bomItemsRes = await client.query('SELECT * FROM bom_items WHERE bom_id = $1 ORDER BY sort_order', [bomId]);

      // 1. Consume raw materials
      for (const bi of bomItemsRes.rows) {
        const effectiveQty = Math.ceil(Number(bi.quantity) * qtyToProduce * (1 + (Number(bi.wastage_percent) || 0) / 100));
        const stockRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE', [bi.item_id, godownId, companyId]);
        const available = stockRes.rows[0]?.quantity || 0;
        if (available < effectiveQty) throw new Error(`Insufficient stock for "${bi.item_name}". Available: ${available}, required: ${effectiveQty}`);
        await client.query('UPDATE item_stock SET quantity = quantity - $1 WHERE item_id = $2 AND godown_id = $3 AND company_id = $4', [effectiveQty, bi.item_id, godownId, companyId]);
        const balRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [bi.item_id, godownId]);
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
           VALUES ($1,$2,$3,'production_consume','bom',$4,$5,$6,$7,$8)`,
          [companyId, bi.item_id, godownId, bomId, -effectiveQty, balRes.rows[0]?.quantity || 0,
           `Consumed for production of ${bom.finished_item_name} x${qtyToProduce}`, req.user!.id]
        );
      }

      // 2. Add finished goods
      if (bom.track_inventory !== false) {
        const costPerUnit = Math.round(bom.total_cost || 0);
        await client.query(
          `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (item_id, godown_id) DO UPDATE SET quantity = item_stock.quantity + EXCLUDED.quantity,
             avg_cost_price = CASE WHEN item_stock.quantity + EXCLUDED.quantity > 0
               THEN ROUND(((item_stock.quantity * item_stock.avg_cost_price) + (EXCLUDED.quantity * EXCLUDED.avg_cost_price)) / (item_stock.quantity + EXCLUDED.quantity))
               ELSE EXCLUDED.avg_cost_price END`,
          [companyId, bom.finished_item_id, godownId, qtyToProduce, costPerUnit]
        );
        const balRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [bom.finished_item_id, godownId]);
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
           VALUES ($1,$2,$3,'production_output','bom',$4,$5,$6,$7,$8)`,
          [companyId, bom.finished_item_id, godownId, bomId, qtyToProduce, balRes.rows[0]?.quantity || qtyToProduce,
           `Produced ${qtyToProduce} units via BOM ${bom.bom_number || bom.bom_name}`, req.user!.id]
        );
      }

      // 3. Production log
      const countRes = await client.query('SELECT COUNT(*)::int as c FROM production_logs WHERE company_id = $1', [companyId]);
      const prodNumber = `PROD-${String((countRes.rows[0]?.c || 0) + 1).padStart(5, '0')}`;
      const logRes = await client.query(
        `INSERT INTO production_logs (company_id, bom_id, production_number, production_date, godown_id, quantity_produced, labour_cost, overhead_cost, total_cost, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [companyId, bomId, prodNumber, d.production_date || new Date().toISOString().split('T')[0], godownId, qtyToProduce,
         Math.round((bom.labour_cost || 0) * qtyToProduce), Math.round((bom.overhead_cost || 0) * qtyToProduce),
         Math.round((bom.total_cost || 0) * qtyToProduce), d.notes || null, req.user!.id]
      );
      return logRes.rows[0];
    });

    res.status(201).json(success(result));
  } catch (err: any) {
    const msg = err?.message || 'Production failed';
    res.status(/not found/i.test(msg) ? 404 : /Insufficient|Godown/i.test(msg) ? 400 : 500).json(error(msg));
  }
}

// ── GET /api/bom/production-logs ──────────────────────────────
export async function listProductionLogs(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const countRes = await query('SELECT COUNT(*) FROM production_logs WHERE company_id = $1 AND is_deleted = false', [companyId]);
    const result = await query(
      `SELECT pl.*, b.bom_name, b.bom_number, fi.name as finished_item_name, fi.sku as finished_item_sku,
              g.name as godown_name, usr.name as created_by_name
       FROM production_logs pl LEFT JOIN bom b ON pl.bom_id = b.id LEFT JOIN items fi ON b.finished_item_id = fi.id
       LEFT JOIN godowns g ON pl.godown_id = g.id LEFT JOIN users usr ON pl.created_by = usr.id
       WHERE pl.company_id = $1 AND pl.is_deleted = false ORDER BY pl.production_date DESC, pl.created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
