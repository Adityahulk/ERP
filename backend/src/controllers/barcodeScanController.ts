import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import { isSmartBarcode, decodeSmartBarcode } from '../utils/barcodeUtils';

/**
 * Resolve a scanned barcode string to an item row, inside an active
 * transaction client. Supports both the "Smart Barcode" format
 * (SC|companyId|itemId, printed from the Label Editor) and plain
 * barcodes / SKUs (matched against items.barcode, items.sku, or the
 * legacy barcode_registry mapping table).
 */
async function resolveItemForScan(client: any, rawBarcode: string, companyId: string) {
  const barcode = String(rawBarcode || '').trim();
  if (!barcode) return null;

  if (isSmartBarcode(barcode)) {
    const decoded = decodeSmartBarcode(barcode);
    if (!decoded || decoded.companyId !== companyId) return null;
    const res = await client.query(
      `SELECT id, name, sku, barcode, track_inventory
       FROM items
       WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
      [decoded.itemId, companyId]
    );
    return res.rows[0] || null;
  }

  const res = await client.query(
    `SELECT id, name, sku, barcode, track_inventory
     FROM items
     WHERE (
       barcode = $1
       OR sku = $1
       OR id = (SELECT item_id FROM barcode_registry WHERE barcode = $1 LIMIT 1)
     )
     AND company_id = $2 AND is_deleted = false
     LIMIT 1`,
    [barcode, companyId]
  );
  return res.rows[0] || null;
}

// ── POST /api/barcode/scan-out ─────────────────────────────────
// Body: { barcode: string, godown_id: uuid, quantity?: number, notes?: string }
// Scans a barcode, locates the item, deducts the scanned quantity from
// the chosen godown's stock, and writes a stock_movements audit row.
export async function scanAndDeduct(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { barcode, godown_id, notes } = req.body;
    const quantity = Number(req.body.quantity ?? 1);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json(error('Quantity must be a positive number'));
    }

    const result = await withTransaction(async (client) => {
      const item = await resolveItemForScan(client, barcode, companyId);
      if (!item) {
        throw new Error('No item found for this barcode');
      }
      if (!item.track_inventory) {
        throw new Error(`Item "${item.name}" does not track inventory — nothing to deduct`);
      }

      const godownRes = await client.query(
        `SELECT id, name FROM godowns WHERE id = $1 AND company_id = $2 AND is_deleted = false`,
        [godown_id, companyId]
      );
      if (!godownRes.rows.length) {
        throw new Error('Invalid godown');
      }

      // Lock the stock row so two simultaneous scans can never both
      // succeed against the same last unit.
      const stockRes = await client.query(
        `SELECT quantity FROM item_stock
         WHERE item_id = $1 AND godown_id = $2 AND company_id = $3
         FOR UPDATE`,
        [item.id, godown_id, companyId]
      );

      const currentQty = stockRes.rows.length ? Number(stockRes.rows[0].quantity) : 0;
      if (currentQty < quantity) {
        throw new Error(
          `Insufficient stock for "${item.name}". Available: ${currentQty}, scanned: ${quantity}`
        );
      }

      // Atomic, conditional decrement — the WHERE clause re-checks the
      // quantity so a race between two requests can never push stock
      // below zero, even without relying solely on the row lock above.
      const deduct = await client.query(
        `UPDATE item_stock
         SET quantity = quantity - $1, updated_at = now()
         WHERE company_id = $2 AND item_id = $3 AND godown_id = $4 AND quantity >= $1`,
        [quantity, companyId, item.id, godown_id]
      );
      if (deduct.rowCount !== 1) {
        throw new Error('Failed to deduct stock (concurrent scan?) — please try again');
      }

      const balRes = await client.query(
        `SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3`,
        [item.id, godown_id, companyId]
      );
      const balanceAfter = Number(balRes.rows[0].quantity);

      const movementRes = await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
         VALUES ($1, $2, $3, 'barcode_scan_out', 'barcode_scan', NULL, $4, $5, $6, $7)
         RETURNING *`,
        [companyId, item.id, godown_id, -quantity, balanceAfter, notes || null, userId]
      );

      await client.query(
        `UPDATE items SET last_scanned_at = now(), scan_count = scan_count + 1 WHERE id = $1`,
        [item.id]
      );

      return {
        item: { id: item.id, name: item.name, sku: item.sku, barcode: item.barcode },
        godown: godownRes.rows[0],
        quantity_scanned: quantity,
        quantity_before: currentQty,
        quantity_after: balanceAfter,
        movement: movementRes.rows[0],
      };
    });

    await logAction(userId, companyId, 'scan_deduct', 'stock_movement', result.movement.id, null, result, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) {
    const msg = err?.message || String(err);
    const badReq = /No item found|Insufficient stock|Invalid godown|does not track inventory|positive number|concurrent scan/i.test(msg);
    res.status(badReq ? 400 : 500).json(error(msg));
  }
}

// ── GET /api/barcode/scan/history ───────────────────────────────
// Query: page, limit, item_id?, godown_id?, from_date?, to_date?
// Returns the audit trail of every barcode-driven stock deduction.
// ── POST /api/barcode/scan ───────────────────────────────────────
// Body: { barcode, mode: 'sale'|'purchase'|'transfer'|'audit', godown_id,
//         to_godown_id? (transfer only), counted_quantity? (audit only),
//         quantity?, notes? }
// Unified scan endpoint covering all four modes. scanAndDeduct above
// is kept as-is for backward compatibility with existing callers.
export async function scanWithMode(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { barcode, mode, godown_id, to_godown_id, notes } = req.body;
    if (!['sale', 'purchase', 'transfer', 'audit'].includes(mode)) {
      return res.status(400).json(error('mode must be sale, purchase, transfer, or audit'));
    }

    const result = await withTransaction(async (client) => {
      const item = await resolveItemForScan(client, barcode, companyId);
      if (!item) throw new Error('No item found for this barcode');
      if (!item.track_inventory) throw new Error(`Item "${item.name}" does not track inventory`);

      const godownRes = await client.query(`SELECT id, name FROM godowns WHERE id = $1 AND company_id = $2 AND is_deleted = false`, [godown_id, companyId]);
      if (!godownRes.rows.length) throw new Error('Invalid godown');

      const stockRes = await client.query(`SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE`, [item.id, godown_id, companyId]);
      const before = stockRes.rows.length ? Number(stockRes.rows[0].quantity) : 0;

      let after = before;
      let movementType = '';
      let delta = 0;
      const quantity = Number(req.body.quantity ?? 1);

      if (mode === 'sale') {
        if (before < quantity) throw new Error(`Insufficient stock — available: ${before}, scanned: ${quantity}`);
        delta = -quantity; movementType = 'barcode_scan_out';
      } else if (mode === 'purchase') {
        delta = quantity; movementType = 'barcode_scan_in';
      } else if (mode === 'audit') {
        const counted = Number(req.body.counted_quantity);
        if (!Number.isFinite(counted) || counted < 0) throw new Error('counted_quantity is required for audit mode');
        delta = counted - before; movementType = 'barcode_audit_adjustment';
      } else if (mode === 'transfer') {
        if (!to_godown_id) throw new Error('to_godown_id is required for transfer mode');
        if (before < quantity) throw new Error(`Insufficient stock to transfer — available: ${before}, requested: ${quantity}`);
        delta = -quantity; movementType = 'barcode_transfer_out';
      }

      await client.query(`INSERT INTO item_stock (company_id, item_id, godown_id, quantity) VALUES ($1,$2,$3,0) ON CONFLICT (item_id, godown_id) DO NOTHING`, [companyId, item.id, godown_id]);
      const upd = await client.query(
        `UPDATE item_stock SET quantity = quantity + $1, updated_at = now() WHERE company_id = $2 AND item_id = $3 AND godown_id = $4 AND quantity + $1 >= 0`,
        [delta, companyId, item.id, godown_id],
      );
      if (upd.rowCount !== 1) throw new Error('Failed to update stock (concurrent scan?) — please try again');
      after = before + delta;

      const movementRes = await client.query(
        `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, quantity, balance_before, balance_after, notes, scan_mode, created_by)
         VALUES ($1,$2,$3,$4,'barcode_scan',$5,$6,$7,$8,$9,$10) RETURNING *`,
        [companyId, item.id, godown_id, movementType, delta, before, after, notes || null, mode, userId],
      );

      // Transfer also has a real receiving leg into the destination godown.
      let transferIn = null;
      if (mode === 'transfer') {
        await client.query(`INSERT INTO item_stock (company_id, item_id, godown_id, quantity) VALUES ($1,$2,$3,0) ON CONFLICT (item_id, godown_id) DO NOTHING`, [companyId, item.id, to_godown_id]);
        const toBeforeRes = await client.query(`SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3`, [item.id, to_godown_id, companyId]);
        const toBefore = Number(toBeforeRes.rows[0]?.quantity || 0);
        await client.query(`UPDATE item_stock SET quantity = quantity + $1, updated_at = now() WHERE company_id = $2 AND item_id = $3 AND godown_id = $4`, [quantity, companyId, item.id, to_godown_id]);
        transferIn = (await client.query(
          `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, quantity, balance_before, balance_after, notes, scan_mode, created_by)
           VALUES ($1,$2,$3,'barcode_transfer_in','barcode_scan',$4,$5,$6,$7,'transfer',$8) RETURNING *`,
          [companyId, item.id, to_godown_id, quantity, toBefore, toBefore + quantity, notes || null, userId],
        )).rows[0];
      }

      await client.query(`UPDATE items SET last_scanned_at = now(), scan_count = scan_count + 1 WHERE id = $1`, [item.id]);

      return { item: { id: item.id, name: item.name, sku: item.sku }, mode, quantity_before: before, quantity_after: after, movement: movementRes.rows[0], transferIn };
    });

    await logAction(userId, companyId, `scan_${result.mode}`, 'stock_movement', result.movement.id, null, result, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) {
    const msg = err?.message || String(err);
    const badReq = /No item found|Insufficient stock|Invalid godown|does not track inventory|required for|concurrent scan|mode must be/i.test(msg);
    res.status(badReq ? 400 : 500).json(error(msg));
  }
}

// ── GET /api/barcode/registry ────────────────────────────────────
// Real registry: every item with a barcode/assign-code, its current
// stock per godown, and last scan — not a separate tracked table,
// just a real view over items + item_stock + stock_movements.
export async function getBarcodeRegistry(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { search } = req.query;
    const where: string[] = ['it.company_id = $1', 'it.is_deleted = false', `(it.barcode IS NOT NULL OR it.sku IS NOT NULL)`];
    const params: any[] = [companyId];
    if (search) {
      where.push(`(it.barcode ILIKE $${params.length + 1} OR it.sku ILIKE $${params.length + 1} OR it.name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    const rows = await query(
      `SELECT it.id, it.barcode, it.sku AS assign_code, it.name AS item_name, it.last_scanned_at, it.scan_count,
              COALESCE(SUM(s.quantity), 0) AS total_stock,
              json_agg(DISTINCT jsonb_build_object('godown', g.name, 'qty', s.quantity)) FILTER (WHERE g.id IS NOT NULL) AS by_godown
       FROM items it
       LEFT JOIN item_stock s ON s.item_id = it.id AND s.company_id = it.company_id
       LEFT JOIN godowns g ON g.id = s.godown_id
       WHERE ${where.join(' AND ')}
       GROUP BY it.id, it.barcode, it.sku, it.name, it.last_scanned_at, it.scan_count
       ORDER BY it.name LIMIT 200`,
      params,
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/barcode/registry/:itemId/history ────────────────────
export async function getItemBarcodeHistory(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT sm.*, g.name AS godown_name, u.name AS user_name
       FROM stock_movements sm
       LEFT JOIN godowns g ON g.id = sm.godown_id
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.item_id = $1 AND sm.company_id = $2
       ORDER BY sm.created_at DESC LIMIT 100`,
      [req.params.itemId, req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function getScanHistory(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { item_id, godown_id, from_date, to_date } = req.query;

    let where = `m.company_id = $1 AND m.movement_type = 'barcode_scan_out'`;
    const params: any[] = [companyId];
    let idx = 2;

    if (item_id) { where += ` AND m.item_id = $${idx}`; params.push(item_id); idx++; }
    if (godown_id) { where += ` AND m.godown_id = $${idx}`; params.push(godown_id); idx++; }
    if (from_date) { where += ` AND m.created_at >= $${idx}`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND m.created_at <= $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM stock_movements m WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await query(
      `SELECT m.id, m.item_id, m.godown_id, m.quantity, m.balance_after, m.notes, m.created_at,
              i.name as item_name, i.sku, i.barcode,
              g.name as godown_name, u.name as scanned_by_name
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
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}
