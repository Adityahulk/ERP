import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';

// ── GET /api/stock ────────────────────────────────────────────
export async function listStock(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { godown_id, category_id, low_stock, out_of_stock } = req.query;

    let where = 'i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true';
    const params: any[] = [companyId];
    let idx = 2;

    if (category_id) { where += ` AND i.category_id = $${idx}`; params.push(category_id); idx++; }

    let stockWhere = '';
    if (godown_id) { stockWhere = ` AND s.godown_id = $${idx}`; params.push(godown_id); idx++; }

    if (low_stock === 'true') { where += ` AND COALESCE(s.quantity, 0) > 0 AND COALESCE(s.quantity, 0) <= i.reorder_point`; }
    if (out_of_stock === 'true') { where += ` AND COALESCE(s.quantity, 0) = 0`; }

    const countRes = await query(
      `SELECT COUNT(DISTINCT i.id) FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id ${stockWhere}
       WHERE ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT i.id, i.name, i.sku, i.hsn_code, i.item_type, i.reorder_point,
              i.purchase_price, i.selling_price, i.gst_rate, i.is_active,
              c.name as category_name, u.name as unit_name, u.abbreviation as unit_abbr,
              COALESCE(s.quantity, 0) as quantity,
              COALESCE(s.available_quantity, 0) as available_quantity,
              COALESCE(s.avg_cost_price, i.purchase_price) as avg_cost_price,
              g.name as godown_name, g.id as godown_id
       FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id ${stockWhere}
       LEFT JOIN godowns g ON s.godown_id = g.id
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       WHERE ${where}
       ORDER BY i.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Summary stats
    const statsRes = await query(
      `SELECT 
         COUNT(DISTINCT i.id) as total_items,
         COALESCE(SUM(s.quantity * s.avg_cost_price), 0) as total_value,
         COUNT(DISTINCT CASE WHEN s.quantity <= i.reorder_point AND s.quantity > 0 THEN i.id END) as low_stock_count,
         COUNT(DISTINCT CASE WHEN COALESCE(s.quantity, 0) = 0 THEN i.id END) as out_of_stock_count
       FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id ${stockWhere}
       WHERE ${where.replace(/ AND COALESCE\(s\.quantity.*$/g, '')}`, params.slice(0, godown_id ? 3 : 2)
    );

    const resp = buildPaginatedResponse(result.rows, total, page, limit);
    res.json(success(resp, statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/stock/item/:itemId ───────────────────────────────
export async function getItemStock(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const companyId = req.user!.company_id;

    const stockRes = await query(
      `SELECT s.*, g.name as godown_name, g.code as godown_code
       FROM item_stock s JOIN godowns g ON s.godown_id = g.id
       WHERE s.item_id = $1 AND s.company_id = $2
       ORDER BY g.name`,
      [itemId, companyId]
    );

    const movementsRes = await query(
      `SELECT m.*, u.name as created_by_name, g.name as godown_name
       FROM stock_movements m
       LEFT JOIN users u ON m.created_by = u.id
       LEFT JOIN godowns g ON m.godown_id = g.id
       WHERE m.item_id = $1 AND m.company_id = $2
       ORDER BY m.created_at DESC LIMIT 20`,
      [itemId, companyId]
    );

    const batchRes = await query(
      'SELECT * FROM item_batches WHERE item_id = $1 AND company_id = $2 AND is_deleted = false ORDER BY expiry_date',
      [itemId, companyId]
    );

    res.json(success({
      stock: stockRes.rows,
      movements: movementsRes.rows,
      batches: batchRes.rows,
      total: stockRes.rows.reduce((s: number, r: any) => s + r.quantity, 0),
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/stock/transfer ──────────────────────────────────
export async function createTransfer(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from_godown_id, to_godown_id, transfer_date, items, notes } = req.body;

    if (from_godown_id === to_godown_id) {
      return res.status(400).json(error('Source and destination godowns must be different'));
    }

    // Validate stock availability
    for (const item of items) {
      const stockRes = await query(
        'SELECT quantity, available_quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2',
        [item.item_id, from_godown_id]
      );
      if (!stockRes.rows.length || stockRes.rows[0].available_quantity < item.quantity) {
        const itemName = await query('SELECT name FROM items WHERE id = $1', [item.item_id]);
        return res.status(400).json(error(
          `Insufficient stock for "${itemName.rows[0]?.name || item.item_id}". Available: ${stockRes.rows[0]?.available_quantity || 0}`
        ));
      }
    }

    const result = await withTransaction(async (client) => {
      // Generate transfer number
      const numRes = await client.query(
        `SELECT COUNT(*) + 1 as num FROM stock_transfers WHERE company_id = $1`, [companyId]
      );
      const transferNum = `TRF-${String(numRes.rows[0].num).padStart(4, '0')}`;

      const transferRes = await client.query(
        `INSERT INTO stock_transfers (company_id, transfer_number, from_godown_id, to_godown_id, status, transfer_date, notes, created_by)
         VALUES ($1,$2,$3,$4,'in_transit',$5,$6,$7) RETURNING *`,
        [companyId, transferNum, from_godown_id, to_godown_id, transfer_date, notes, req.user!.id]
      );

      for (const item of items) {
        await client.query(
          'INSERT INTO stock_transfer_items (transfer_id, item_id, quantity_sent) VALUES ($1,$2,$3)',
          [transferRes.rows[0].id, item.item_id, item.quantity]
        );

        // Reserve stock at source
        await client.query(
          'UPDATE item_stock SET reserved_quantity = reserved_quantity + $1 WHERE item_id = $2 AND godown_id = $3',
          [item.quantity, item.item_id, from_godown_id]
        );
      }

      return transferRes.rows[0];
    });

    await logAction(req.user!.id, companyId, 'create', 'stock_transfer', result.id, null, { from: from_godown_id, to: to_godown_id }, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/stock/transfer/:id/receive ──────────────────────
export async function receiveTransfer(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { items } = req.body;

    const transferRes = await query(
      'SELECT * FROM stock_transfers WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]
    );
    if (!transferRes.rows.length) return res.status(404).json(error('Transfer not found'));
    const transfer = transferRes.rows[0];
    if (transfer.status !== 'in_transit') return res.status(400).json(error('Transfer is not in transit'));

    await withTransaction(async (client) => {
      for (const item of items) {
        // Update transfer item
        await client.query(
          'UPDATE stock_transfer_items SET quantity_received = $1 WHERE transfer_id = $2 AND item_id = $3',
          [item.quantity_received, id, item.item_id]
        );

        const sentRes = await client.query(
          'SELECT quantity_sent FROM stock_transfer_items WHERE transfer_id = $1 AND item_id = $2',
          [id, item.item_id]
        );
        const qtySent = sentRes.rows[0]?.quantity_sent || item.quantity_received;

        // Get cost price for movement
        const costRes = await client.query(
          'SELECT avg_cost_price FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, transfer.from_godown_id]
        );
        const costPrice = costRes.rows[0]?.avg_cost_price || 0;

        // Deduct from source (un-reserve and remove)
        await client.query(
          `UPDATE item_stock SET quantity = quantity - $1, reserved_quantity = reserved_quantity - $1 
           WHERE item_id = $2 AND godown_id = $3`,
          [qtySent, item.item_id, transfer.from_godown_id]
        );

        // Add to destination
        await client.query(
          `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (item_id, godown_id) DO UPDATE SET quantity = item_stock.quantity + $4`,
          [companyId, item.item_id, transfer.to_godown_id, item.quantity_received, costPrice]
        );

        // Stock movements
        const fromBalance = await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [item.item_id, transfer.from_godown_id]);
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, unit_cost, balance_after, created_by)
           VALUES ($1,$2,$3,'transfer_out','transfer',$4,$5,$6,$7,$8)`,
          [companyId, item.item_id, transfer.from_godown_id, id, -qtySent, costPrice, fromBalance.rows[0]?.quantity || 0, req.user!.id]
        );

        const toBalance = await client.query('SELECT quantity FROM item_stock WHERE item_id=$1 AND godown_id=$2', [item.item_id, transfer.to_godown_id]);
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, unit_cost, balance_after, created_by)
           VALUES ($1,$2,$3,'transfer_in','transfer',$4,$5,$6,$7,$8)`,
          [companyId, item.item_id, transfer.to_godown_id, id, item.quantity_received, costPrice, toBalance.rows[0]?.quantity || 0, req.user!.id]
        );
      }

      // Update transfer status
      await client.query(
        `UPDATE stock_transfers SET status = 'received', received_date = NOW(), received_by = $1 WHERE id = $2`,
        [req.user!.id, id]
      );
    });

    await logAction(req.user!.id, companyId, 'update', 'stock_transfer', id, { status: 'in_transit' }, { status: 'received' }, req.ip);
    res.json(success({ message: 'Transfer received successfully' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/stock/adjustment ────────────────────────────────
export async function createAdjustment(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { godown_id, adjustment_date, reason, items, notes } = req.body;
    const isAdmin = ['company_admin', 'super_admin'].includes(req.user!.role);

    const result = await withTransaction(async (client) => {
      const adjRes = await client.query(
        `INSERT INTO stock_adjustments (company_id, godown_id, adjustment_date, reason, notes, status, created_by, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [companyId, godown_id, adjustment_date, reason, notes, isAdmin ? 'approved' : 'draft', req.user!.id, isAdmin ? req.user!.id : null]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO stock_adjustment_items (adjustment_id, item_id, current_quantity, adjusted_quantity, reason)
           VALUES ($1,$2,$3,$4,$5)`,
          [adjRes.rows[0].id, item.item_id, item.current_quantity, item.adjusted_quantity, item.reason]
        );

        // If admin, apply immediately
        if (isAdmin) {
          const diff = item.adjusted_quantity - item.current_quantity;

          await client.query(
            `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
             VALUES ($1,$2,$3,$4, 0)
             ON CONFLICT (item_id, godown_id) DO UPDATE SET quantity = $4`,
            [companyId, item.item_id, godown_id, item.adjusted_quantity]
          );

          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1,$2,$3,'adjustment','adjustment',$4,$5,$6,$7,$8)`,
            [companyId, item.item_id, godown_id, adjRes.rows[0].id, diff, item.adjusted_quantity, item.reason || reason, req.user!.id]
          );
        }
      }

      return adjRes.rows[0];
    });

    await logAction(req.user!.id, companyId, 'create', 'stock_adjustment', result.id);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/stock/movements ──────────────────────────────────
export async function listMovements(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { item_id, godown_id, movement_type, from_date, to_date } = req.query;

    let where = 'm.company_id = $1';
    const params: any[] = [companyId];
    let idx = 2;

    if (item_id) { where += ` AND m.item_id = $${idx}`; params.push(item_id); idx++; }
    if (godown_id) { where += ` AND m.godown_id = $${idx}`; params.push(godown_id); idx++; }
    if (movement_type) { where += ` AND m.movement_type = $${idx}`; params.push(movement_type); idx++; }
    if (from_date) { where += ` AND m.created_at >= $${idx}`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND m.created_at <= $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM stock_movements m WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT m.*, i.name as item_name, i.sku, g.name as godown_name, u.name as created_by_name
       FROM stock_movements m
       JOIN items i ON m.item_id = i.id
       LEFT JOIN godowns g ON m.godown_id = g.id
       LEFT JOIN users u ON m.created_by = u.id
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/stock/valuation ──────────────────────────────────
export async function stockValuation(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;

    // By category
    const byCategoryRes = await query(
      `SELECT c.name as category, 
              COUNT(DISTINCT i.id) as item_count,
              COALESCE(SUM(s.quantity), 0) as total_quantity,
              COALESCE(SUM(s.quantity * s.avg_cost_price), 0) as cost_value,
              COALESCE(SUM(s.quantity * i.selling_price), 0) as selling_value
       FROM items i
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_stock s ON s.item_id = i.id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true
       GROUP BY c.name ORDER BY cost_value DESC`,
      [companyId]
    );

    // By godown
    const byGodownRes = await query(
      `SELECT g.name as godown, g.id as godown_id,
              COUNT(DISTINCT s.item_id) as item_count,
              COALESCE(SUM(s.quantity), 0) as total_quantity,
              COALESCE(SUM(s.quantity * s.avg_cost_price), 0) as cost_value,
              COALESCE(SUM(s.quantity * i.selling_price), 0) as selling_value
       FROM item_stock s
       JOIN godowns g ON s.godown_id = g.id
       JOIN items i ON s.item_id = i.id
       WHERE s.company_id = $1 AND i.is_deleted = false
       GROUP BY g.id, g.name ORDER BY cost_value DESC`,
      [companyId]
    );

    // Totals
    const totalCost = byCategoryRes.rows.reduce((s: number, r: any) => s + parseInt(r.cost_value), 0);
    const totalSelling = byCategoryRes.rows.reduce((s: number, r: any) => s + parseInt(r.selling_value), 0);

    res.json(success({
      total_cost_value: totalCost,
      total_selling_value: totalSelling,
      potential_profit: totalSelling - totalCost,
      by_category: byCategoryRes.rows,
      by_godown: byGodownRes.rows,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/stock/low-stock ──────────────────────────────────
export async function lowStock(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const result = await query(
      `SELECT i.id, i.name, i.sku, i.reorder_point, i.selling_price,
              c.name as category_name, u.abbreviation as unit,
              COALESCE(ts.total_stock, 0) as current_stock,
              i.reorder_point - COALESCE(ts.total_stock, 0) as deficit
       FROM items i
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       LEFT JOIN (SELECT item_id, SUM(quantity) as total_stock FROM item_stock GROUP BY item_id) ts ON ts.item_id = i.id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true
         AND i.reorder_point > 0 AND COALESCE(ts.total_stock, 0) <= i.reorder_point
       ORDER BY (i.reorder_point - COALESCE(ts.total_stock, 0)) DESC`,
      [companyId]
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
