import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import * as XLSX from 'xlsx';
import * as bwipjs from 'bwip-js';
import fs from 'fs';
import path from 'path';
import { decodeSmartBarcode, isSmartBarcode, getOrCreateItemBarcode } from '../utils/barcodeUtils';
import { calculateOpeningStockValuePaise, calculateStockValuation } from '../lib/stockValuation';
import { isSafePaise } from '../lib/money';
import { readImportRows } from '../services/importFile';
import { loadItemImportRefs, planItemImport, ITEM_IMPORT_HEADERS, type ImportClient } from '../services/itemImportPlan';
import { saveItemImportPlan } from '../services/itemImportSave';

function isValidGstRate(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 && Math.round(rate * 1000) === rate * 1000;
}

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
  const qty = Math.round(Number(args.quantity || 0) * 10_000) / 10_000;
  if (qty <= 0) return;
  const unitCost = Math.round(Number(args.unitCost || 0));

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
  const delta = Math.round(Number(args.delta || 0) * 10_000) / 10_000;
  if (delta === 0) return;
  const unitCost = Math.round(Number(args.unitCost || 0));

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
         ROUND(COALESCE(sm.quantity, 0)::numeric * COALESCE(sm.unit_cost, 0)::numeric)::bigint AS gross_amount,
         ROUND(COALESCE(sm.quantity, 0)::numeric * COALESCE(sm.unit_cost, 0)::numeric)::bigint AS taxable_amount,
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

function normalizePrice(price: number, gstRate: number, includesTax: boolean) {
  if (!includesTax) return price;
  return Math.round(price / (1 + gstRate / 100));
}

// ── POST /api/items ───────────────────────────────────────────
export async function createItem(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const data = req.body;
    data.name = String(data.name || '').trim();
    data.sku = String(data.sku || '').trim() || null;
    data.barcode = String(data.barcode || '').trim() || null;
    if (!data.name) return res.status(400).json(error('Item name is required'));
    const itemType = String(data.item_type || 'product').toLowerCase();
    const isService = itemType === 'service';
    const trackInventory = isService ? false : data.track_inventory !== false;
    const openingStock = trackInventory
      ? Math.round(Number(data.opening_stock || 0) * 10_000) / 10_000
      : 0;
    const openingStockValue = trackInventory
      ? calculateOpeningStockValuePaise(openingStock, data.purchase_price || 0)
      : 0;

    // SKU uniqueness
    if (data.sku) {
      const dup = await query(
        'SELECT id FROM items WHERE company_id = $1 AND LOWER(TRIM(sku)) = LOWER(TRIM($2)) AND is_deleted = false', [companyId, data.sku]
      );
      if (dup.rows.length) return res.status(400).json(error('An item with this SKU already exists'));
    }
    if (data.barcode) {
      const dup = await query(
        'SELECT id FROM items WHERE company_id = $1 AND LOWER(TRIM(barcode)) = LOWER(TRIM($2)) AND is_deleted = false', [companyId, data.barcode]
      );
      if (dup.rows.length) return res.status(400).json(error('An item with this barcode already exists'));
    }

    // Auto-calculate tax rates
    const gstRate = data.gst_rate ?? 18;
    const halfRate = gstRate / 2;

    const sellingPriceIncludesTax = data.selling_price_includes_tax === true;
    const purchasePriceIncludesTax = data.purchase_price_includes_tax === true;

    const normalizedSellingPrice = normalizePrice(
      data.selling_price || 0,
      gstRate,
      sellingPriceIncludesTax
    );
    const normalizedPurchasePrice = normalizePrice(
      data.purchase_price || 0,
      gstRate,
      purchasePriceIncludesTax
    );

    const result = await withTransaction(async (client) => {
      let barcode = data.barcode || null;
      if (!barcode && itemType !== 'service') {
        let unique = false;
        let attempts = 0;
        while (!unique && attempts < 100) {
          attempts++;
          const seqRes = await client.query("SELECT nextval('barcode_num_seq')");
          const nextVal = seqRes.rows[0].nextval;
          barcode = String(nextVal).padStart(10, '0');

          const dupRes = await client.query(
            `SELECT 1 FROM items WHERE barcode = $1 AND is_deleted = false
             UNION
             SELECT 1 FROM barcode_registry WHERE company_id = $2 AND barcode = $1`,
            [barcode, companyId]
          );
          if (dupRes.rows.length === 0) {
            unique = true;
          }
        }
        if (!unique) {
          throw new Error('Failed to generate a unique sequential barcode after multiple attempts.');
        }
      }

      const itemRes = await client.query(
        `INSERT INTO items (
          company_id, name, description, sku, barcode, hsn_code, category_id, brand, unit_id,
          secondary_unit_id, unit_conversion_factor,
          item_type, track_inventory, is_serialized,
          purchase_price, selling_price, price_currency_code,
          tax_preference, gst_rate, cgst_rate, sgst_rate, igst_rate, cess_rate,
          opening_stock, opening_stock_value, opening_stock_date,
          reorder_point, max_stock_level, image_url, custom_fields,
          selling_price_includes_tax, purchase_price_includes_tax
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
        ) RETURNING *`,
        [
          companyId, data.name, data.description, data.sku, barcode, data.hsn_code,
          data.category_id, data.brand, data.unit_id,
          data.secondary_unit_id, data.unit_conversion_factor,
          itemType,
          trackInventory,
          isService ? false : data.is_serialized || false,
          normalizedPurchasePrice, normalizedSellingPrice,
          String(data.price_currency_code || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR',
          data.tax_preference || 'taxable', gstRate, halfRate, halfRate, gstRate,
          data.cess_rate || 0,
          openingStock, openingStockValue,
          trackInventory ? data.opening_stock_date || null : null,
          data.reorder_point || 0, data.max_stock_level || 0,
          data.image_url, data.custom_fields ? JSON.stringify(data.custom_fields) : '{}',
          sellingPriceIncludesTax, purchasePriceIncludesTax
        ]
      );

      const item = itemRes.rows[0];

      // Save barcode to registry if it exists
      if (item.barcode) {
        await client.query(
          `INSERT INTO barcode_registry (company_id, barcode, item_id, source, is_primary)
           VALUES ($1, $2, $3, 'system', true)
           ON CONFLICT (company_id, barcode) DO UPDATE
             SET item_id = EXCLUDED.item_id,
                 is_primary = true`,
          [companyId, item.barcode, item.id]
        );
      }

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
    if (err?.code === '23505') return res.status(409).json(error('An item with this SKU or barcode already exists'));
    const status = /Opening stock|Purchase price|supported range|Select a godown|Enable inventory/i.test(err.message) ? 400 : 500;
    res.status(status).json(error(err.message));
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
              COALESCE(ts.total_value, 0) as total_stock_value,
              COALESCE(ts.shortfall_value, 0) as stock_shortfall_value,
              COALESCE(ts.has_negative_stock, false) as has_negative_stock
              ${godownCols}
       FROM items i
       ${stockJoin}
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       LEFT JOIN (
         SELECT stock.item_id,
                SUM(stock.quantity) as total_stock,
                ROUND(SUM(GREATEST(stock.quantity, 0) * COALESCE(NULLIF(stock.avg_cost_price, 0), valuation_item.purchase_price, 0))) as total_value,
                ROUND(SUM(ABS(LEAST(stock.quantity, 0)) * COALESCE(NULLIF(stock.avg_cost_price, 0), valuation_item.purchase_price, 0))) as shortfall_value,
                BOOL_OR(stock.quantity < 0) as has_negative_stock
         FROM item_stock stock
         JOIN items valuation_item ON valuation_item.id = stock.item_id
         GROUP BY stock.item_id
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
      `SELECT s.id, s.company_id, s.item_id, s.godown_id, s.quantity,
              s.reserved_quantity, s.available_quantity,
              s.avg_cost_price AS stored_avg_cost_price,
              COALESCE(NULLIF(s.avg_cost_price, 0), i.purchase_price, 0) AS avg_cost_price,
              s.updated_at, g.name as godown_name, g.code as godown_code
       FROM item_stock s
       JOIN items i ON i.id = s.item_id AND i.company_id = s.company_id
       JOIN godowns g ON s.godown_id = g.id
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

    const serialNumbersRes = await query(
      `SELECT id, serial_number, status, godown_id, created_at
       FROM item_serial_numbers
       WHERE item_id = $1 AND company_id = $2
       ORDER BY serial_number`,
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
    const valuation = calculateStockValuation(stockRes.rows);

    res.json(success({
      ...item,
      stock: stockRes.rows,
      total_stock: valuation.stockOnHand,
      total_stock_value: valuation.stockValue,
      stock_shortfall_value: valuation.stockShortfallValue,
      has_negative_stock: valuation.hasNegativeStock,
      recent_movements: movementsRes.rows,
      serial_numbers: serialNumbersRes.rows,
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
    if (data.name !== undefined) {
      data.name = String(data.name || '').trim();
      if (!data.name) return res.status(400).json(error('Item name is required'));
    }
    if (data.sku !== undefined) data.sku = String(data.sku || '').trim() || null;
    if (data.barcode !== undefined) data.barcode = String(data.barcode || '').trim() || null;
    if (data.gst_rate !== undefined && !isValidGstRate(data.gst_rate)) {
      return res.status(400).json(error('GST rate must be between 0 and 100 with at most three decimal places'));
    }
    if (data.cess_rate !== undefined && !isValidGstRate(data.cess_rate)) {
      return res.status(400).json(error('Cess rate must be between 0 and 100 with at most three decimal places'));
    }
    for (const field of ['purchase_price', 'selling_price', 'opening_stock_value'] as const) {
      if (data[field] !== undefined && (!isSafePaise(data[field]) || Number(data[field]) < 0)) {
        return res.status(400).json(error(`${field.replaceAll('_', ' ')} must be a non-negative amount in paise`));
      }
    }
    for (const field of ['opening_stock', 'reorder_point', 'max_stock_level'] as const) {
      if (data[field] !== undefined && (!Number.isFinite(Number(data[field])) || Number(data[field]) < 0)) {
        return res.status(400).json(error(`${field.replaceAll('_', ' ')} cannot be negative`));
      }
    }
    if (data.opening_stock !== undefined) {
      data.opening_stock = Math.round(Number(data.opening_stock) * 10_000) / 10_000;
    }

    const oldRes = await query('SELECT * FROM items WHERE id = $1 AND company_id = $2 AND is_deleted = false', [id, companyId]);
    if (!oldRes.rows.length) return res.status(404).json(error('Item not found'));
    const old = oldRes.rows[0];
    const enteredPurchasePrice = Math.round(
      data.purchase_price !== undefined
        ? Number(data.purchase_price || 0)
        : Number(old.purchase_price || 0) * (old.purchase_price_includes_tax ? 1 + Number(old.gst_rate || 0) / 100 : 1),
    );

    // SKU uniqueness check
    if (data.sku && data.sku !== old.sku) {
      const dup = await query('SELECT id FROM items WHERE company_id = $1 AND LOWER(TRIM(sku)) = LOWER(TRIM($2)) AND is_deleted = false AND id != $3', [companyId, data.sku, id]);
      if (dup.rows.length) return res.status(400).json(error('An item with this SKU already exists'));
    }
    if (data.barcode && data.barcode !== old.barcode) {
      const dup = await query('SELECT id FROM items WHERE company_id = $1 AND LOWER(TRIM(barcode)) = LOWER(TRIM($2)) AND is_deleted = false AND id != $3', [companyId, data.barcode, id]);
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

    const sellingIncludes = data.selling_price_includes_tax !== undefined ? data.selling_price_includes_tax : old.selling_price_includes_tax;
    const purchaseIncludes = data.purchase_price_includes_tax !== undefined ? data.purchase_price_includes_tax : old.purchase_price_includes_tax;
    const nextGst = data.gst_rate !== undefined ? Number(data.gst_rate) : Number(old.gst_rate);

    if (data.selling_price !== undefined) {
      data.selling_price = normalizePrice(data.selling_price, nextGst, sellingIncludes);
    }
    if (data.purchase_price !== undefined) {
      data.purchase_price = normalizePrice(data.purchase_price, nextGst, purchaseIncludes);
    }
    if (nextItemType !== 'service' && (data.opening_stock !== undefined || data.purchase_price !== undefined)) {
      data.opening_stock_value = calculateOpeningStockValuePaise(
        data.opening_stock ?? old.opening_stock ?? 0,
        enteredPurchasePrice,
      );
    }

    const result = await withTransaction(async (client) => {
      const fields = [
        'name', 'description', 'sku', 'barcode', 'hsn_code', 'category_id', 'brand', 'unit_id',
        'secondary_unit_id', 'unit_conversion_factor',
        'item_type', 'track_inventory', 'is_serialized',
        'purchase_price', 'selling_price', 'price_currency_code',
        'tax_preference', 'gst_rate', 'cgst_rate', 'sgst_rate', 'igst_rate', 'cess_rate',
        'opening_stock', 'opening_stock_value', 'opening_stock_date',
        'reorder_point', 'max_stock_level', 'image_url', 'is_active', 'custom_fields',
        'selling_price_includes_tax', 'purchase_price_includes_tax'
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
        const nextOpening = Number(data.opening_stock || 0);
        const prevOpening = Number(old.opening_stock || 0);
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
      if (data.barcode !== undefined && data.barcode !== old.barcode) {
        if (old.barcode) {
          await client.query(
            `DELETE FROM barcode_registry
             WHERE company_id = $1 AND item_id = $2 AND barcode = $3 AND is_primary = true`,
            [companyId, id, old.barcode],
          );
        }
        if (data.barcode) {
          await client.query(
            `INSERT INTO barcode_registry (company_id, barcode, item_id, source, is_primary)
             VALUES ($1, $2, $3, 'system', true)
             ON CONFLICT (company_id, barcode) DO UPDATE
               SET item_id = EXCLUDED.item_id,
                   source = 'system',
                   is_primary = true`,
            [companyId, data.barcode, id],
          );
        }
      }
      return upd.rows[0];
    });

    await logAction(req.user!.id, companyId, 'update', 'item', id, old, result, req.ip);
    res.json(success(result));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    if (err?.code === '23505') return res.status(409).json(error('An item with this SKU or barcode already exists'));
    const status = /No fields|Opening stock|Select a godown|Enable inventory/i.test(err.message) ? 400 : 500;
    res.status(status).json(error(err.message));
  }
}

type ItemDeletionAssessment = {
  id: string;
  name: string;
  reason: string | null;
  reasonCode: 'not_found' | null;
};

async function lockAndAssessItemForDeletion(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  companyId: string,
  id: string,
): Promise<ItemDeletionAssessment> {
  const itemResult = await client.query(
    `SELECT id, name
     FROM items
     WHERE company_id = $1 AND id = $2 AND is_deleted = false
     FOR UPDATE`,
    [companyId, id],
  );
  const item = itemResult.rows[0];
  if (!item) {
    return {
      id,
      name: 'Unknown item',
      reason: 'Item was not found or was already deleted.',
      reasonCode: 'not_found',
    };
  }

  return { id, name: String(item.name || 'Unnamed item'), reason: null, reasonCode: null };
}

export async function clearItemStockForDeletion(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  companyId: string,
  itemId: string,
  userId: string,
) {
  const stockRows = await client.query(
    `SELECT godown_id, quantity, COALESCE(reserved_quantity, 0) AS reserved_quantity,
            COALESCE(avg_cost_price, 0) AS avg_cost_price
     FROM item_stock
     WHERE company_id = $1 AND item_id = $2
     FOR UPDATE`,
    [companyId, itemId],
  );

  for (const stock of stockRows.rows) {
    const quantity = Number(stock.quantity || 0);
    if (quantity !== 0) {
      await client.query(
        `INSERT INTO stock_movements (
           company_id, item_id, godown_id, movement_type, reference_type, reference_id,
           quantity, unit_cost, balance_after, notes, created_by
         ) VALUES ($1,$2,$3,'adjustment','bulk_item_delete',$2,$4,$5,0,$6,$7)`,
        [
          companyId,
          itemId,
          stock.godown_id,
          -quantity,
          Number(stock.avg_cost_price || 0),
          'Stock cleared by administrator before bulk item deletion',
          userId,
        ],
      );
    }
  }

  await client.query(
    `DELETE FROM item_stock
     WHERE company_id = $1 AND item_id = $2`,
    [companyId, itemId],
  );
  await client.query(
    `UPDATE item_batches
     SET quantity = 0, is_deleted = true, updated_at = NOW()
     WHERE company_id = $1 AND item_id = $2 AND is_deleted = false`,
    [companyId, itemId],
  );
  await client.query(
    `UPDATE item_serial_numbers
     SET status = 'written_off', updated_at = NOW()
     WHERE company_id = $1 AND item_id = $2 AND status = 'available'`,
    [companyId, itemId],
  );
  await client.query(
    `DELETE FROM barcode_label_profiles
     WHERE company_id = $1 AND item_id = $2`,
    [companyId, itemId],
  );
}

// ── DELETE /api/items/:id ─────────────────────────────────────
export async function deleteItem(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const outcome = await withTransaction(async (client) => {
      const assessment = await lockAndAssessItemForDeletion(client, companyId, id);
      if (assessment.reasonCode === 'not_found') return { status: 'not_found' as const };
      await clearItemStockForDeletion(client, companyId, id, req.user!.id);
      const result = await client.query(
        `UPDATE items SET is_deleted = true, is_active = false, updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND is_deleted = false RETURNING id`,
        [id, companyId],
      );
      if (!result.rows.length) return { status: 'not_found' as const };
      await client.query('DELETE FROM barcode_registry WHERE company_id = $1 AND item_id = $2', [companyId, id]);
      return { status: 'deleted' as const };
    });
    if (outcome.status === 'not_found') return res.status(404).json(error('Item not found'));

    await logAction(req.user!.id, companyId, 'delete', 'item', id, null, null, req.ip);
    res.json(success({ message: 'Item deleted' }));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/items/bulk-delete ───────────────────────────────
export async function bulkDeleteItems(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const ids = Array.from(new Set((req.body.ids as string[]).map(String)));
    const failed: ItemDeletionAssessment[] = [];
    const deleted = await withTransaction(async (client) => {
      const completed: Array<{ id: string; name: string; stock_cleared: boolean }> = [];
      for (const id of ids) {
        const item = await lockAndAssessItemForDeletion(client, companyId, id);
        if (item.reasonCode === 'not_found') {
          failed.push(item);
          continue;
        }
        await clearItemStockForDeletion(client, companyId, item.id, req.user!.id);
        const result = await client.query(
          `UPDATE items SET is_deleted = true, is_active = false, updated_at = NOW()
           WHERE id = $1 AND company_id = $2 AND is_deleted = false RETURNING id`,
          [item.id, companyId],
        );
        if (!result.rows.length) {
          failed.push({
            ...item,
            reason: 'Item changed or was deleted before this request completed.',
            reasonCode: 'not_found',
          });
          continue;
        }
        await client.query('DELETE FROM barcode_registry WHERE company_id = $1 AND item_id = $2', [companyId, item.id]);
        completed.push({ id: item.id, name: item.name, stock_cleared: true });
      }
      return completed;
    });

    for (const item of deleted) {
      await logAction(
        req.user!.id,
        companyId,
        'delete',
        'item',
        item.id,
        null,
        { source: 'bulk_delete', stock_cleared: item.stock_cleared },
        req.ip,
      );
    }

    res.json(success({ deleted, failed, requested: ids.length }));
  } catch (err: any) {
    console.error('itemController bulk delete error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message || 'Bulk delete failed'));
  }
}

// ── POST /api/items/bulk-import ───────────────────────────────
export async function bulkImport(req: Request, res: Response) {
  if (!req.file) return res.status(400).json(error('Choose an XLSX, XLS, CSV or JSON file'));
  try {
    const companyId = req.user!.company_id;
    const stockOnly = req.params.type === 'stock';
    const rows = readImportRows(req.file, stockOnly ? 'stock' : 'items', [ITEM_IMPORT_HEADERS]);
    if (!rows.length) return res.status(400).json(error('The uploaded file has no item rows'));
    const resolutions = req.body?.resolutions ? JSON.parse(String(req.body.resolutions)) : {};
    if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions)
      || Object.values(resolutions).some((value) => typeof value !== 'string')) {
      return res.status(400).json(error('Import selections are invalid'));
    }
    const confirm = req.query.action === 'confirm';
    const run = async (client: ImportClient) => {
      if (confirm) await client.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE', [companyId]);
      const refs = await loadItemImportRefs(client, companyId, confirm);
      const plan = planItemImport(rows, refs, { godownId: String(req.body?.godown_id || ''), resolutions, stockOnly });
      if (!confirm) return { status: 200, body: success(plan) };
      if (!req.body?.preview_hash || req.body.preview_hash !== plan.preview_hash) {
        return { status: 409, body: { ...error('Import preview changed. Review the refreshed preview before saving.'), data: plan } };
      }
      if (plan.errors.length && req.body?.allow_partial !== 'true') {
        return { status: 400, body: { ...error('Resolve the remaining issues or explicitly choose to import valid rows only.'), data: plan } };
      }
      if (plan.transfers && req.body?.confirm_transfers !== 'true') {
        return { status: 400, body: error('Confirm the serial transfers before importing.') };
      }
      if (plan.conversions && req.body?.confirm_conversions !== 'true') return { status: 400, body: error('Confirm the legacy bulk-reference conversions before importing.') };
      if (!plan.valid) return { status: 400, body: error('No rows are ready to import') };
      return { status: 200, body: success(await saveItemImportPlan(client, plan, companyId, req.user!.id)) };
    };
    const result = confirm ? await withTransaction(run) : await run({ query });
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    return res.status(400).json(error(err.message || 'Item import failed'));
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* upload cleanup */ }
  }
}

// ── GET /api/items/import-template ────────────────────────────
export async function importTemplate(_req: Request, res: Response) {
  try {
    const headers = [
      'Item ID', 'Name', 'Serial No', 'Serial Reference', 'SKU', 'Barcode', 'HSN Code', 'Brand', 'Item Type',
      'Selling Price', 'Purchase Price', 'GST Rate', 'Opening Stock', 'Reorder Point', 'Godown Name',
    ];
    const example = [
      '', 'Basmati Rice 5kg', '', '', 'RICE-5KG', '8901234567890', '1006', 'India Gate', 'product',
      450, 350, 5, 100, 20, '',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Instructions'], ['Delete example rows. Prices are in rupees. Select the target godown before uploading.'],
      ['Item ID is optional for new items; keep it when reimporting an export from this company.'],
      ['Serial No identifies one unit with quantity 0 or 1. Leave it blank for bulk stock.'],
      ['Serial Reference preserves batch, packaging or supplier reference values for bulk quantities.'],
      ['Existing prices are kept. Stock quantity replaces only the selected godown balance.'],
    ]), 'Instructions');

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

    const barcodeText = await getOrCreateItemBarcode(id, companyId);

    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: barcodeText,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
    } as any);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename=barcode-${id}.png`);
    res.send(png);
  } catch (err: any) {
    console.error('itemController error:', err.message);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/items/:id/barcode ──────────────────────────────
export async function getOrGenerateBarcode(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const barcode = await getOrCreateItemBarcode(id, companyId);
    res.json(success({ barcode }));
  } catch (err: any) {
    console.error('getOrGenerateBarcode error:', err.message);
    res.status(500).json(error(err.message));
  }
}

// ── POST /api/items/scan ──────────────────────────────────────
async function findItemByScannableCode(companyId: string, code: string, godownId?: string | null) {
  const stockParams: any[] = [companyId];
  let stockJoin = `LEFT JOIN (
    SELECT item_id, SUM(quantity) AS total_stock
    FROM item_stock
    WHERE company_id = $1
    GROUP BY item_id
  ) ts ON ts.item_id = i.id`;
  let stockSelect = 'COALESCE(ts.total_stock, 0) AS total_stock, COALESCE(ts.total_stock, 0) AS available_stock';
  if (godownId) {
    stockParams.push(godownId);
    stockJoin = `LEFT JOIN item_stock ts
      ON ts.item_id = i.id AND ts.company_id = $1 AND ts.godown_id = $2`;
    stockSelect = 'COALESCE(ts.quantity, 0) AS total_stock, COALESCE(ts.quantity, 0) AS available_stock';
  }

  if (isSmartBarcode(code)) {
    const decoded = decodeSmartBarcode(code);
    if (!decoded || decoded.companyId !== companyId) return { rows: [] as any[] };
    return query(
      `SELECT i.*, c.name AS category_name,
              COALESCE(u.abbreviation, u.name, 'PCS') AS unit,
              u.name AS unit_name,
              ${stockSelect}
       FROM items i
       LEFT JOIN item_categories c ON i.category_id = c.id
       LEFT JOIN item_units u ON i.unit_id = u.id
       ${stockJoin}
       WHERE i.id = $${stockParams.length + 1}
         AND i.company_id = $1
         AND i.is_deleted = false
         AND i.is_active = true
       LIMIT 1`,
      [...stockParams, decoded.itemId],
    );
  }

  return query(
    `SELECT i.*, c.name AS category_name,
            COALESCE(u.abbreviation, u.name, 'PCS') AS unit,
            u.name AS unit_name,
            ${stockSelect}
     FROM items i
     LEFT JOIN item_categories c ON i.category_id = c.id
     LEFT JOIN item_units u ON i.unit_id = u.id
     ${stockJoin}
     WHERE i.company_id = $1
       AND i.is_deleted = false
       AND i.is_active = true
       AND (
         i.barcode = $${stockParams.length + 1}
         OR i.sku = $${stockParams.length + 1}
         OR i.id = (
           SELECT br.item_id
           FROM barcode_registry br
           WHERE br.company_id = $1 AND br.barcode = $${stockParams.length + 1}
           LIMIT 1
         )
       )
     LIMIT 1`,
    [...stockParams, code],
  );
}

export async function scanBarcode(req: Request, res: Response) {
  try {
    const { barcode, godown_id } = req.body;
    const companyId = req.user!.company_id;
    const result = await findItemByScannableCode(companyId, String(barcode || '').trim(), godown_id);

    if (!result.rows.length) return res.status(404).json(error('No item found for this barcode'));
    res.json(success(result.rows[0]));
  } catch (err: any) {
    console.error('itemController error:', err.message, err.detail, err.position);
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/items/barcode/:code ──────────────────────────────
export async function getItemByBarcode(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const companyId = req.user!.company_id;
    const godownId = typeof req.query.godown_id === 'string' ? req.query.godown_id : null;
    const result = await findItemByScannableCode(companyId, String(code || '').trim(), godownId);

    if (!result.rows.length) return res.status(404).json(error('No item found for this barcode'));
    res.json(success(result.rows[0]));
  } catch (err: any) {
    console.error('getItemByBarcode error:', err.message);
    res.status(500).json(error(err.message));
  }
}
