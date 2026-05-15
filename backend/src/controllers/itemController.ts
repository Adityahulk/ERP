import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import * as XLSX from 'xlsx';
import * as bwipjs from 'bwip-js';
import fs from 'fs';
import path from 'path';

const VALID_GST_RATES = new Set([0, 1, 3, 5, 6, 12, 18, 28, 40]);

async function applyOpeningStock(
  client: { query: (q: string, p?: any[]) => Promise<{ rows: any[] }> },
  args: {
    companyId: string;
    itemId: string;
    godownId: string;
    quantity: number;
    unitCost: number;
    createdBy: string;
    notes?: string;
  }
) {
  const qty = Number(args.quantity || 0);
  if (qty <= 0) return;
  const unitCost = Number(args.unitCost || 0);

  await client.query(
    `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, godown_id) DO UPDATE
       SET quantity = item_stock.quantity + EXCLUDED.quantity`,
    [args.companyId, args.itemId, args.godownId, qty, unitCost],
  );

  const balRes = await client.query(
    `SELECT quantity FROM item_stock WHERE company_id = $1 AND item_id = $2 AND godown_id = $3`,
    [args.companyId, args.itemId, args.godownId],
  );
  await client.query(
    `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, quantity, unit_cost, balance_after, notes, created_by)
     VALUES ($1, $2, $3, 'opening_stock', $4, $5, $6, $7, $8)`,
    [
      args.companyId,
      args.itemId,
      args.godownId,
      qty,
      unitCost,
      Number(balRes.rows[0]?.quantity || qty),
      args.notes || 'Opening stock',
      args.createdBy,
    ],
  );
}

async function adjustOpeningStock(
  client: { query: (q: string, p?: any[]) => Promise<{ rows: any[] }> },
  args: {
    companyId: string;
    itemId: string;
    godownId: string;
    delta: number;
    unitCost: number;
    createdBy: string;
    notes?: string;
  }
) {
  const delta = Math.trunc(Number(args.delta || 0));
  if (delta === 0) return;
  const unitCost = Number(args.unitCost || 0);

  const stockRes = await client.query(
    `SELECT quantity FROM item_stock
     WHERE company_id = $1 AND item_id = $2 AND godown_id = $3
     FOR UPDATE`,
    [args.companyId, args.itemId, args.godownId],
  );
  const currentQty = Number(stockRes.rows[0]?.quantity || 0);
  if (currentQty + delta < 0) {
    throw new Error('Opening stock change would make godown stock negative');
  }

  const upd = await client.query(
    `INSERT INTO item_stock (company_id, item_id, godown_id, quantity, avg_cost_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, godown_id) DO UPDATE
       SET quantity = item_stock.quantity + EXCLUDED.quantity,
           avg_cost_price = CASE
             WHEN EXCLUDED.avg_cost_price > 0 THEN EXCLUDED.avg_cost_price
             ELSE item_stock.avg_cost_price
           END,
           updated_at = NOW()
     RETURNING quantity`,
    [args.companyId, args.itemId, args.godownId, delta, unitCost],
  );

  await client.query(
    `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, quantity, unit_cost, balance_after, notes, created_by)
     VALUES ($1, $2, $3, 'opening_stock', $4, $5, $6, $7, $8)`,
    [
      args.companyId,
      args.itemId,
      args.godownId,
      delta,
      unitCost,
      Number(upd.rows[0]?.quantity || currentQty + delta),
      args.notes || 'Opening stock adjustment',
      args.createdBy,
    ],
  );
}

async function resolveOpeningStockGodown(
  client: { query: (q: string, p?: any[]) => Promise<{ rows: any[] }> },
  companyId: string,
  itemId: string,
  requestedGodownId?: string | null,
  fallbackGodownId?: string | null,
) {
  if (requestedGodownId) return requestedGodownId;
  if (fallbackGodownId) return fallbackGodownId;

  const movementRes = await client.query(
    `SELECT godown_id FROM stock_movements
     WHERE company_id = $1 AND item_id = $2 AND movement_type = 'opening_stock' AND godown_id IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, itemId],
  );
  if (movementRes.rows[0]?.godown_id) return movementRes.rows[0].godown_id;

  const stockRes = await client.query(
    `SELECT godown_id FROM item_stock
     WHERE company_id = $1 AND item_id = $2
     ORDER BY quantity DESC, updated_at DESC
     LIMIT 1`,
    [companyId, itemId],
  );
  return stockRes.rows[0]?.godown_id || null;
}

async function getItemActivity(companyId: string, itemId: string) {
  const timelineRes = await query(
    `WITH sales AS (
       SELECT
         'sale'::text AS activity_type,
         'out'::text AS direction,
         i.invoice_date::timestamp AS activity_at,
         i.invoice_number AS reference_number,
         COALESCE(p.name, 'Walk-in customer') AS counterparty_name,
         COALESCE(g.name, '—') AS godown_name,
         -COALESCE(ii.quantity, 0)::numeric AS quantity,
         COALESCE(ii.unit_price, 0)::bigint AS unit_price,
         COALESCE(ii.total_amount, 0)::bigint AS gross_amount,
         COALESCE(ii.taxable_amount, 0)::bigint AS taxable_amount,
         COALESCE(ii.cgst_amount, 0)::bigint + COALESCE(ii.sgst_amount, 0)::bigint + COALESCE(ii.igst_amount, 0)::bigint + COALESCE(ii.cess_amount, 0)::bigint AS tax_amount,
         COALESCE(i.status, 'draft') AS status,
         i.id AS reference_id,
         COALESCE(NULLIF(TRIM(i.notes), ''), NULLIF(TRIM(ii.item_description), '')) AS notes
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN parties p ON p.id = i.party_id
       LEFT JOIN godowns g ON g.id = i.godown_id
       WHERE ii.item_id = $1
         AND i.company_id = $2
         AND i.is_deleted = false
         AND i.status != 'cancelled'
         AND i.invoice_type IN ('sale', 'tax_invoice')
     ),
     purchases AS (
       SELECT
         'purchase'::text AS activity_type,
         'in'::text AS direction,
         pi.bill_date::timestamp AS activity_at,
         pi.bill_number AS reference_number,
         COALESCE(p.name, 'Supplier') AS counterparty_name,
         COALESCE(g.name, '—') AS godown_name,
         COALESCE(pii.quantity, 0)::numeric AS quantity,
         COALESCE(pii.unit_price, 0)::bigint AS unit_price,
         COALESCE(pii.total_amount, 0)::bigint AS gross_amount,
         GREATEST(
           COALESCE(pii.total_amount, 0)::bigint
           - COALESCE(pii.cgst_amount, 0)::bigint
           - COALESCE(pii.sgst_amount, 0)::bigint
           - COALESCE(pii.igst_amount, 0)::bigint,
           0
         ) AS taxable_amount,
         COALESCE(pii.cgst_amount, 0)::bigint + COALESCE(pii.sgst_amount, 0)::bigint + COALESCE(pii.igst_amount, 0)::bigint AS tax_amount,
         COALESCE(pi.status, 'draft') AS status,
         pi.id AS reference_id,
         COALESCE(NULLIF(TRIM(pi.notes), ''), NULLIF(TRIM(pii.item_name), '')) AS notes
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
       LEFT JOIN parties p ON p.id = pi.party_id
       LEFT JOIN godowns g ON g.id = pi.godown_id
       WHERE pii.item_id = $1
         AND pi.company_id = $2
         AND pi.is_deleted = false
         AND COALESCE(pi.status, '') != 'cancelled'
     ),
     adjustments AS (
       SELECT
         'adjustment'::text AS activity_type,
         CASE WHEN COALESCE(sai.adjusted_quantity, 0) - COALESCE(sai.current_quantity, 0) >= 0 THEN 'in'::text ELSE 'out'::text END AS direction,
         sa.adjustment_date::timestamp AS activity_at,
         CONCAT('ADJ-', LEFT(sa.id::text, 8)) AS reference_number,
         COALESCE(sa.reason, 'Adjustment') AS counterparty_name,
         COALESCE(g.name, '—') AS godown_name,
         (COALESCE(sai.adjusted_quantity, 0) - COALESCE(sai.current_quantity, 0))::numeric AS quantity,
         0::bigint AS unit_price,
         0::bigint AS gross_amount,
         0::bigint AS taxable_amount,
         0::bigint AS tax_amount,
         COALESCE(sa.status, 'draft') AS status,
         sa.id AS reference_id,
         COALESCE(NULLIF(TRIM(sai.reason), ''), sa.notes, sa.reason) AS notes
       FROM stock_adjustment_items sai
       JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
       LEFT JOIN godowns g ON g.id = sa.godown_id
       WHERE sai.item_id = $1
         AND sa.company_id = $2
         AND sa.is_deleted = false
     ),
     transfer_out AS (
       SELECT
         'transfer_out'::text AS activity_type,
         'out'::text AS direction,
         st.transfer_date::timestamp AS activity_at,
         COALESCE(st.transfer_number, CONCAT('TRF-', LEFT(st.id::text, 8))) AS reference_number,
         COALESCE(tg.name, 'Internal transfer') AS counterparty_name,
         COALESCE(fg.name, '—') AS godown_name,
         -COALESCE(sti.quantity_sent, 0)::numeric AS quantity,
         0::bigint AS unit_price,
         0::bigint AS gross_amount,
         0::bigint AS taxable_amount,
         0::bigint AS tax_amount,
         COALESCE(st.status, 'draft') AS status,
         st.id AS reference_id,
         st.notes
       FROM stock_transfer_items sti
       JOIN stock_transfers st ON st.id = sti.transfer_id
       LEFT JOIN godowns fg ON fg.id = st.from_godown_id
       LEFT JOIN godowns tg ON tg.id = st.to_godown_id
       WHERE sti.item_id = $1
         AND st.company_id = $2
         AND st.is_deleted = false
     ),
     transfer_in AS (
       SELECT
         'transfer_in'::text AS activity_type,
         'in'::text AS direction,
         st.transfer_date::timestamp AS activity_at,
         COALESCE(st.transfer_number, CONCAT('TRF-', LEFT(st.id::text, 8))) AS reference_number,
         COALESCE(fg.name, 'Internal transfer') AS counterparty_name,
         COALESCE(tg.name, '—') AS godown_name,
         COALESCE(NULLIF(sti.quantity_received, 0), sti.quantity_sent, 0)::numeric AS quantity,
         0::bigint AS unit_price,
         0::bigint AS gross_amount,
         0::bigint AS taxable_amount,
         0::bigint AS tax_amount,
         COALESCE(st.status, 'draft') AS status,
         st.id AS reference_id,
         st.notes
       FROM stock_transfer_items sti
       JOIN stock_transfers st ON st.id = sti.transfer_id
       LEFT JOIN godowns fg ON fg.id = st.from_godown_id
       LEFT JOIN godowns tg ON tg.id = st.to_godown_id
       WHERE sti.item_id = $1
         AND st.company_id = $2
         AND st.is_deleted = false
     ),
     opening_stock AS (
       SELECT
         'opening_stock'::text AS activity_type,
         'in'::text AS direction,
         sm.created_at AS activity_at,
         'Opening stock'::text AS reference_number,
         'Opening stock'::text AS counterparty_name,
         COALESCE(g.name, '—') AS godown_name,
         COALESCE(sm.quantity, 0)::numeric AS quantity,
         COALESCE(sm.unit_cost, 0)::bigint AS unit_price,
         (COALESCE(sm.quantity, 0)::bigint * COALESCE(sm.unit_cost, 0)::bigint) AS gross_amount,
         (COALESCE(sm.quantity, 0)::bigint * COALESCE(sm.unit_cost, 0)::bigint) AS taxable_amount,
         0::bigint AS tax_amount,
         'posted'::text AS status,
         sm.id AS reference_id,
         sm.notes
       FROM stock_movements sm
       LEFT JOIN godowns g ON g.id = sm.godown_id
       WHERE sm.item_id = $1
         AND sm.company_id = $2
         AND sm.movement_type = 'opening_stock'
     )
     SELECT *
     FROM (
       SELECT * FROM sales
       UNION ALL
       SELECT * FROM purchases
       UNION ALL
       SELECT * FROM adjustments
       UNION ALL
       SELECT * FROM transfer_out
       UNION ALL
       SELECT * FROM transfer_in
       UNION ALL
       SELECT * FROM opening_stock
     ) activity
     ORDER BY activity_at DESC, reference_number DESC
     LIMIT 100`,
    [itemId, companyId]
  );

  const summaryRes = await query(
    `SELECT
       COALESCE((
         SELECT COUNT(DISTINCT i.id)::int
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE ii.item_id = $1
           AND i.company_id = $2
           AND i.is_deleted = false
           AND i.status != 'cancelled'
           AND i.invoice_type IN ('sale', 'tax_invoice')
       ), 0) AS sales_count,
       COALESCE((
         SELECT SUM(ii.quantity)::numeric
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE ii.item_id = $1
           AND i.company_id = $2
           AND i.is_deleted = false
           AND i.status != 'cancelled'
           AND i.invoice_type IN ('sale', 'tax_invoice')
       ), 0) AS sold_quantity,
       COALESCE((
         SELECT MAX(i.invoice_date)
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE ii.item_id = $1
           AND i.company_id = $2
           AND i.is_deleted = false
           AND i.status != 'cancelled'
           AND i.invoice_type IN ('sale', 'tax_invoice')
       ), NULL) AS last_sale_date,
       COALESCE((
         SELECT COUNT(DISTINCT pi.id)::int
         FROM purchase_invoice_items pii
         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
         WHERE pii.item_id = $1
           AND pi.company_id = $2
           AND pi.is_deleted = false
           AND COALESCE(pi.status, '') != 'cancelled'
       ), 0) AS purchase_count,
       COALESCE((
         SELECT SUM(pii.quantity)::numeric
         FROM purchase_invoice_items pii
         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
         WHERE pii.item_id = $1
           AND pi.company_id = $2
           AND pi.is_deleted = false
           AND COALESCE(pi.status, '') != 'cancelled'
       ), 0) AS purchased_quantity,
       COALESCE((
         SELECT MAX(pi.bill_date)
         FROM purchase_invoice_items pii
         JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
         WHERE pii.item_id = $1
           AND pi.company_id = $2
           AND pi.is_deleted = false
           AND COALESCE(pi.status, '') != 'cancelled'
       ), NULL) AS last_purchase_date`,
    [itemId, companyId]
  );

  return {
    timeline: timelineRes.rows,
    summary: summaryRes.rows[0] || {},
  };
}

// ── POST /api/items ───────────────────────────────────────────
export async function createItem(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const data = req.body;
    const itemType = String(data.item_type || 'product').toLowerCase();
    const isService = itemType === 'service';
    const trackInventory = isService ? false : data.track_inventory !== false;
    const openingStock = trackInventory ? Number(data.opening_stock || 0) : 0;
    const openingStockValue = trackInventory ? Number(data.opening_stock_value || 0) : 0;

    // SKU uniqueness
    if (data.sku) {
      const dup = await query(
        'SELECT id FROM items WHERE company_id = $1 AND sku = $2 AND is_deleted = false', [companyId, data.sku]
      );
      if (dup.rows.length) return res.status(400).json(error('An item with this SKU already exists'));
    }
    if (data.barcode) {
      const dup = await query(
        'SELECT id FROM items WHERE company_id = $1 AND barcode = $2 AND is_deleted = false', [companyId, data.barcode]
      );
      if (dup.rows.length) return res.status(400).json(error('An item with this barcode already exists'));
    }

    // Auto-calculate tax rates
    const gstRate = data.gst_rate ?? 18;
    const halfRate = gstRate / 2;

    const result = await withTransaction(async (client) => {
      const itemRes = await client.query(
        `INSERT INTO items (
          company_id, name, description, sku, barcode, hsn_code, category_id, brand, unit_id,
          secondary_unit_id, unit_conversion_factor,
          item_type, track_inventory, is_serialized,
          purchase_price, selling_price,
          tax_preference, gst_rate, cgst_rate, sgst_rate, igst_rate, cess_rate,
          opening_stock, opening_stock_value, opening_stock_date,
          reorder_point, max_stock_level, image_url, custom_fields
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
        ) RETURNING *`,
        [
          companyId, data.name, data.description, data.sku, data.barcode || null, data.hsn_code,
          data.category_id, data.brand, data.unit_id,
          data.secondary_unit_id, data.unit_conversion_factor,
          itemType,
          trackInventory,
          isService ? false : data.is_serialized || false,
          data.purchase_price || 0, data.selling_price || 0,
          data.tax_preference || 'taxable', gstRate, halfRate, halfRate, gstRate,
          data.cess_rate || 0,
          openingStock, openingStockValue,
          trackInventory ? data.opening_stock_date || null : null,
          data.reorder_point || 0, data.max_stock_level || 0,
          data.image_url, data.custom_fields ? JSON.stringify(data.custom_fields) : '{}',
        ]
      );

      const item = itemRes.rows[0];

      // Create initial stock if opening_stock > 0
      if (openingStock > 0 && trackInventory) {
        const godownId = data.godown_id || req.user!.godown_id;
        if (!godownId) {
          throw new Error('Select a godown before setting opening stock');
        }
        const qty = openingStock;
        const openingValue = openingStockValue;
        const unitCost = qty > 0 && openingValue > 0 ? openingValue / qty : Number(data.purchase_price || 0);
        await applyOpeningStock(client, {
          companyId,
          itemId: item.id,
          godownId,
          quantity: qty,
          unitCost,
          createdBy: req.user!.id,
          notes: 'Opening stock',
        });
      }

      return item;
    });

    await logAction(req.user!.id, companyId, 'create', 'item', result.id, null, { name: data.name }, req.ip);
    res.status(201).json(success(result));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/items ────────────────────────────────────────────
export async function listItems(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { search, category_id, item_type, is_active, low_stock, godown_id } = req.query;

    let where = 'i.company_id = $1 AND i.is_deleted = false';
    const params: any[] = [companyId];
    let idx = 2;

    if (search) {
      where += ` AND (i.name ILIKE $${idx} OR i.sku ILIKE $${idx} OR i.barcode ILIKE $${idx} OR i.hsn_code ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }
    if (category_id) { where += ` AND i.category_id = $${idx}`; params.push(category_id); idx++; }
    if (item_type) { where += ` AND i.item_type = $${idx}`; params.push(item_type); idx++; }
    if (is_active !== undefined) { where += ` AND i.is_active = $${idx}`; params.push(is_active === 'true'); idx++; }

    // Stock-related filters use a subquery
    let stockJoin = '';
    if (low_stock === 'true' || godown_id || req.query.out_of_stock === 'true') {
      if (godown_id) {
        stockJoin = ` LEFT JOIN item_stock s ON s.item_id = i.id AND s.company_id = i.company_id AND s.godown_id = $${idx}`;
        params.push(godown_id); idx++;
      } else {
        stockJoin = ` LEFT JOIN (SELECT item_id, SUM(quantity) as quantity FROM item_stock GROUP BY item_id) s ON s.item_id = i.id`;
      }
      if (low_stock === 'true') { where += ` AND i.track_inventory = true AND COALESCE(s.quantity, 0) <= i.reorder_point AND COALESCE(s.quantity, 0) > 0`; }
      if (req.query.out_of_stock === 'true') { where += ` AND i.track_inventory = true AND COALESCE(s.quantity, 0) = 0`; }
      if (godown_id && req.query.with_positive_stock_in_godown === 'true') {
        where += ` AND i.track_inventory = true AND COALESCE(s.quantity, 0) > 0`;
      }
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM items i ${stockJoin} WHERE ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const godownCols =
      godown_id && stockJoin.includes('item_stock s')
        ? `, COALESCE(s.quantity, 0) as godown_quantity, COALESCE(s.available_quantity, 0) as godown_available`
        : '';

    const result = await query(
      `SELECT i.*, 
              c.name as category_name, u.name as unit_name, u.abbreviation as unit_abbr,
              COALESCE(ts.total_stock, 0) as total_stock,
              COALESCE(ts.total_value, 0) as total_stock_value
              ${godownCols}
       FROM items i
       ${stockJoin}
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       LEFT JOIN (
         SELECT item_id, SUM(quantity) as total_stock, SUM(quantity * avg_cost_price) as total_value 
         FROM item_stock GROUP BY item_id
       ) ts ON ts.item_id = i.id
       WHERE ${where}
       ORDER BY i.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json(success(buildPaginatedResponse(result.rows, total, page, limit)));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/items/:id ────────────────────────────────────────
export async function getItem(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const itemRes = await query(
      `SELECT i.*, c.name as category_name, u.name as unit_name, u.abbreviation as unit_abbr,
              su.name as secondary_unit_name, su.abbreviation as secondary_unit_abbr
       FROM items i
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       LEFT JOIN item_units su ON i.secondary_unit_id = su.id
       WHERE i.id = $1 AND i.company_id = $2 AND i.is_deleted = false`,
      [id, companyId]
    );
    if (!itemRes.rows.length) return res.status(404).json(error('Item not found'));

    // Stock per godown
    const stockRes = await query(
      `SELECT s.*, g.name as godown_name, g.code as godown_code
       FROM item_stock s JOIN godowns g ON s.godown_id = g.id
       WHERE s.item_id = $1 AND s.company_id = $2
       ORDER BY g.name`,
      [id, companyId]
    );

    // Recent movements
    const movementsRes = await query(
      `SELECT m.*, u.name as created_by_name, g.name as godown_name
       FROM stock_movements m
       LEFT JOIN users u ON m.created_by = u.id
       LEFT JOIN godowns g ON m.godown_id = g.id
       WHERE m.item_id = $1 AND m.company_id = $2
       ORDER BY m.created_at DESC LIMIT 10`,
      [id, companyId]
    );

    const activity = await getItemActivity(companyId, id);

    // Batches if applicable
    const item = itemRes.rows[0];
    let batches: any[] = [];
    if (item.is_serialized) {
      const batchRes = await query(
        'SELECT * FROM item_batches WHERE item_id = $1 AND company_id = $2 AND is_deleted = false ORDER BY created_at DESC',
        [id, companyId]
      );
      batches = batchRes.rows;
    }

    // Total stock
    const totalStock = stockRes.rows.reduce((sum: number, s: any) => sum + s.quantity, 0);
    const totalValue = stockRes.rows.reduce((sum: number, s: any) => sum + (s.quantity * s.avg_cost_price), 0);

    res.json(success({
      ...item,
      stock: stockRes.rows,
      total_stock: totalStock,
      total_stock_value: totalValue,
      recent_movements: movementsRes.rows,
      activity_timeline: activity.timeline,
      activity_summary: activity.summary,
      batches,
    }));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── PATCH /api/items/:id ──────────────────────────────────────
export async function updateItem(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const data = req.body;

    const oldRes = await query('SELECT * FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!oldRes.rows.length) return res.status(404).json(error('Item not found'));
    const old = oldRes.rows[0];

    // SKU uniqueness check
    if (data.sku && data.sku !== old.sku) {
      const dup = await query('SELECT id FROM items WHERE company_id = $1 AND sku = $2 AND is_deleted = false AND id != $3', [companyId, data.sku, id]);
      if (dup.rows.length) return res.status(400).json(error('An item with this SKU already exists'));
    }
    if (data.barcode && data.barcode !== old.barcode) {
      const dup = await query('SELECT id FROM items WHERE company_id = $1 AND barcode = $2 AND is_deleted = false AND id != $3', [companyId, data.barcode, id]);
      if (dup.rows.length) return res.status(400).json(error('An item with this barcode already exists'));
    }

    // If gst_rate changed, recalculate
    if (data.gst_rate !== undefined) {
      data.cgst_rate = data.gst_rate / 2;
      data.sgst_rate = data.gst_rate / 2;
      data.igst_rate = data.gst_rate;
    }
    const nextItemType = String(data.item_type ?? old.item_type ?? 'product').toLowerCase();
    if (nextItemType === 'service') {
      data.item_type = 'service';
      data.track_inventory = false;
      data.is_serialized = false;
      data.opening_stock = 0;
      data.opening_stock_value = 0;
      data.opening_stock_date = null;
    }

    const result = await withTransaction(async (client) => {
      const fields = [
        'name','description','sku','barcode','hsn_code','category_id','brand','unit_id',
        'secondary_unit_id','unit_conversion_factor',
        'item_type','track_inventory','is_serialized',
        'purchase_price','selling_price',
        'tax_preference','gst_rate','cgst_rate','sgst_rate','igst_rate','cess_rate',
        'opening_stock','opening_stock_value','opening_stock_date',
        'reorder_point','max_stock_level','image_url','is_active','custom_fields',
      ];
      const updates: string[] = []; const values: any[] = []; let idx = 1;
      for (const f of fields) {
        if (data[f] !== undefined) {
          updates.push(`${f} = $${idx++}`);
          values.push(f === 'custom_fields' ? JSON.stringify(data[f]) : data[f]);
        }
      }
      if (!updates.length) throw new Error('No fields to update');

      if (data.opening_stock !== undefined && nextItemType !== 'service') {
        const trackInventory = nextItemType === 'service' ? false : data.track_inventory !== undefined ? data.track_inventory !== false : old.track_inventory !== false;
        const nextOpening = Math.trunc(Number(data.opening_stock || 0));
        const prevOpening = Math.trunc(Number(old.opening_stock || 0));
        const delta = nextOpening - prevOpening;
        if (delta !== 0) {
          if (!trackInventory) {
            throw new Error('Enable inventory tracking before changing opening stock');
          }
          const godownId = await resolveOpeningStockGodown(
            client,
            companyId,
            id,
            data.godown_id,
            req.user!.godown_id,
          );
          if (!godownId) throw new Error('Select a godown before changing opening stock');
          const openingValue = Number(data.opening_stock_value ?? old.opening_stock_value ?? 0);
          const unitCost = nextOpening > 0 && openingValue > 0 ? openingValue / nextOpening : Number(data.purchase_price ?? old.purchase_price ?? 0);
          await adjustOpeningStock(client, {
            companyId,
            itemId: id,
            godownId,
            delta,
            unitCost,
            createdBy: req.user!.id,
            notes: 'Opening stock updated from item master',
          });
        }
      }

      values.push(id, companyId);
      const upd = await client.query(
        `UPDATE items SET ${updates.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, values
      );
      return upd.rows[0];
    });

    await logAction(req.user!.id, companyId, 'update', 'item', id, old, result, req.ip);
    res.json(success(result));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    const status = /No fields|Opening stock|Select a godown|Enable inventory/i.test(err.message) ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

// ── DELETE /api/items/:id ─────────────────────────────────────
export async function deleteItem(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    // Check for stock
    const stockCheck = await query(
      'SELECT COALESCE(SUM(quantity), 0) as total FROM item_stock WHERE item_id = $1', [id]
    );
    if (parseInt(stockCheck.rows[0].total) > 0) {
      return res.status(400).json(error('Cannot delete item with active stock. Adjust stock to zero first.'));
    }

    // Check for active invoices
    const invCheck = await query(
      `SELECT COUNT(*) as cnt FROM invoice_items ii JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE ii.item_id = $1 AND inv.status != 'cancelled' AND inv.is_deleted = false`, [id]
    );
    if (parseInt(invCheck.rows[0].cnt) > 0) {
      return res.status(400).json(error('Cannot delete item used in active invoices.'));
    }

    const result = await query(
      'UPDATE items SET is_deleted = true WHERE id = $1 AND company_id = $2 RETURNING id', [id, companyId]
    );
    if (!result.rows.length) return res.status(404).json(error('Item not found'));

    await logAction(req.user!.id, companyId, 'delete', 'item', id, null, null, req.ip);
    res.json(success({ message: 'Item deleted' }));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/items/bulk-import ───────────────────────────────
export async function bulkImport(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(error('No file uploaded'));
    const companyId = req.user!.company_id;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let rows: any[] = [];

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet);
    } else if (ext === '.csv') {
      const workbook = XLSX.readFile(req.file.path, { type: 'file' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet);
    } else if (ext === '.json') {
      const content = fs.readFileSync(req.file.path, 'utf-8');
      rows = JSON.parse(content);
    }

    // Map headers and validate
    const preview: any[] = [];
    const errors: any[] = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const importedType = String(row['Item Type'] || row['item_type'] || 'product').trim().toLowerCase();
      const importedIsService = importedType === 'service';
      const item: any = {
        name: row['Name'] || row['name'] || '',
        sku: row['SKU'] || row['sku'] || null,
        barcode: row['Barcode'] || row['barcode'] || row['EAN'] || row['ean'] || null,
        hsn_code: row['HSN Code'] || row['SAC Code'] || row['hsn_code'] || row['sac_code'] || null,
        brand: row['Brand'] || row['brand'] || null,
        item_type: importedType,
        selling_price: Math.round(Number(row['Selling Price'] || row['selling_price'] || 0) * 100),
        purchase_price: Math.round(Number(row['Purchase Price'] || row['purchase_price'] || 0) * 100),
        gst_rate: parseInt(row['GST Rate'] || row['gst_rate'] || 18),
        opening_stock: importedIsService ? 0 : parseInt(row['Opening Stock'] || row['opening_stock'] || 0),
        reorder_point: parseInt(row['Reorder Point'] || row['reorder_point'] || 0),
      };

      const rowErrors: string[] = [];
      if (!item.name) rowErrors.push('Name is required');
      if (!VALID_GST_RATES.has(item.gst_rate)) rowErrors.push('Invalid GST rate');
      if (item.selling_price < 0) rowErrors.push('Selling price cannot be negative');
      const skuKey = String(item.sku || '').trim();
      const barcodeKey = String(item.barcode || '').trim();
      if (skuKey) {
        if (seenSkus.has(skuKey)) rowErrors.push('Duplicate SKU in import file');
        seenSkus.add(skuKey);
        const dupSku = await query('SELECT id FROM items WHERE company_id = $1 AND sku = $2 AND is_deleted = false LIMIT 1', [companyId, skuKey]);
        if (dupSku.rows.length) rowErrors.push('SKU already exists');
      }
      if (barcodeKey) {
        if (seenBarcodes.has(barcodeKey)) rowErrors.push('Duplicate barcode in import file');
        seenBarcodes.add(barcodeKey);
        const dupBarcode = await query('SELECT id FROM items WHERE company_id = $1 AND barcode = $2 AND is_deleted = false LIMIT 1', [companyId, barcodeKey]);
        if (dupBarcode.rows.length) rowErrors.push('Barcode already exists');
      }

      if (rowErrors.length) {
        errors.push({ row: i + 2, errors: rowErrors, data: item });
      } else {
        preview.push({ row: i + 2, data: item, valid: true });
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch {}

    // If action=confirm, insert the valid rows
    if (req.query.action === 'confirm') {
      const importGodownId = String(req.body?.godown_id || req.user!.godown_id || '').trim();
      const hasOpeningRows = preview.some((p) => Number(p.data.opening_stock || 0) > 0);
      if (hasOpeningRows && !importGodownId) {
        return res.status(400).json(error('Pick a godown before importing rows with opening stock'));
      }

      let inserted = 0;
      await withTransaction(async (client) => {
        for (const p of preview) {
          const d = p.data;
          const halfRate = d.gst_rate / 2;
          const isService = d.item_type === 'service';
          const itemIns = await client.query(
            `INSERT INTO items (company_id, name, sku, barcode, hsn_code, brand, item_type, track_inventory, purchase_price, selling_price,
              gst_rate, cgst_rate, sgst_rate, igst_rate, opening_stock, opening_stock_value, reorder_point)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id`,
            [
              companyId,
              d.name,
              d.sku,
              d.barcode,
              d.hsn_code,
              d.brand,
              d.item_type,
              !isService,
              d.purchase_price,
              d.selling_price,
              d.gst_rate,
              halfRate,
              halfRate,
              d.gst_rate,
              isService ? 0 : d.opening_stock,
              isService ? 0 : d.opening_stock * d.purchase_price,
              d.reorder_point,
            ]
          );
          const openingQty = isService ? 0 : Number(d.opening_stock || 0);
          if (openingQty > 0) {
            await applyOpeningStock(client, {
              companyId,
              itemId: itemIns.rows[0].id,
              godownId: importGodownId,
              quantity: openingQty,
              unitCost: Number(d.purchase_price || 0),
              createdBy: req.user!.id,
              notes: 'Opening stock (bulk import)',
            });
          }
          inserted++;
        }
      });
      return res.json(success({ inserted, errors: errors.length }));
    }

    res.json(success({ preview, errors, total: rows.length, valid: preview.length, invalid: errors.length }));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/items/import-template ────────────────────────────
export async function importTemplate(_req: Request, res: Response) {
  try {
    const headers = [
      'Name', 'SKU', 'Barcode', 'HSN Code', 'Brand', 'Item Type',
      'Selling Price', 'Purchase Price', 'GST Rate', 'Opening Stock', 'Reorder Point',
    ];
    const example = [
      'Basmati Rice 5kg', 'RICE-5KG', '8901234567890', '1006', 'India Gate', 'product',
      450, 350, 5, 100, 20,
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=microtechnique_item_import_template.xlsx');
    res.send(buffer);
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/items/:id/barcode-image ──────────────────────────
export async function barcodeImage(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;

    const itemRes = await query(
      'SELECT id, sku, barcode, name FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false',
      [id, companyId]
    );
    if (!itemRes.rows.length) return res.status(404).json(error('Item not found'));

    const item = itemRes.rows[0];
    let barcodeText = item.barcode || item.sku;

    // Auto-generate EAN-13 if no barcode
    if (!barcodeText) {
      const timestamp = Date.now().toString().slice(-9);
      const base = '890' + timestamp;
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(base[i]) * (i % 2 === 0 ? 1 : 3);
      }
      const check = (10 - (sum % 10)) % 10;
      barcodeText = base + check;

      await query('UPDATE items SET barcode = $1 WHERE id = $2', [barcodeText, id]);
    }

    const png = await bwipjs.toBuffer({
      bcid: barcodeText.length === 13 ? 'ean13' : 'code128',
      text: barcodeText,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    } as any);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename=barcode-${item.sku || id}.png`);
    res.send(png);
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/items/scan ──────────────────────────────────────
export async function scanBarcode(req: Request, res: Response) {
  try {
    const { barcode } = req.body;
    const companyId = req.user!.company_id;

    const result = await query(
      `SELECT i.*, c.name as category_name, u.name as unit_name,
              COALESCE(ts.total_stock, 0) as total_stock
       FROM items i
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       LEFT JOIN (SELECT item_id, SUM(quantity) as total_stock FROM item_stock GROUP BY item_id) ts ON ts.item_id = i.id
       WHERE (i.barcode = $1 OR i.sku = $1) AND i.company_id = $2 AND i.is_deleted = false
       LIMIT 1`,
      [barcode, companyId]
    );

    if (!result.rows.length) return res.status(404).json(error('No item found for this barcode'));
    res.json(success(result.rows[0]));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}
