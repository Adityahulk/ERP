import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { success, error } from '../lib/response';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import { logAction } from '../lib/auditLog';
import { calculateInvoiceTotals, determineGSTType } from '../services/gstService';

// ── Helpers ───────────────────────────────────────────────────
async function generateWSOrderNumber(companyId: string): Promise<string> {
  const prefixRes = await query('SELECT wholesale_prefix FROM companies WHERE id = $1', [companyId]);
  const prefix = prefixRes.rows[0]?.wholesale_prefix || 'WS';
  const countRes = await query(
    `SELECT COUNT(*) as count FROM wholesale_orders WHERE company_id = $1 AND created_at >= date_trunc('year', now())`, [companyId]
  );
  const yearStr = new Date().getFullYear().toString().slice(-2);
  return `${prefix}/${yearStr}/${String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0')}`;
}

async function resolveTierPrice(companyId: string, itemId: string, quantity: number): Promise<{ price: number; tierName: string | null }> {
  const tierRes = await query(
    `SELECT price, tier_name FROM wholesale_price_tiers
     WHERE company_id = $1 AND item_id = $2 AND is_active = true AND min_quantity <= $3
     ORDER BY min_quantity DESC LIMIT 1`,
    [companyId, itemId, quantity]
  );
  if (tierRes.rows.length) return { price: tierRes.rows[0].price, tierName: tierRes.rows[0].tier_name };
  const itemRes = await query('SELECT selling_price FROM items WHERE id = $1', [itemId]);
  return { price: itemRes.rows[0]?.selling_price || 0, tierName: null };
}

// ── POST /api/wholesale ───────────────────────────────────────
export async function createWholesaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const d = req.body;
    if (!d.party_id) return res.status(400).json(error('Party is required'));
    if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json(error('Items are required'));

    const result = await withTransaction(async (client) => {
      const orderNumber = await generateWSOrderNumber(companyId);
      const pRes = await client.query('SELECT state_code, name, gstin, billing_address, shipping_address FROM parties WHERE id = $1', [d.party_id]);
      if (!pRes.rows.length) throw new Error('Party not found');
      const party = pRes.rows[0];

      const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
      const gstType = determineGSTType(party.state_code, cRes.rows[0].state_code);

      // Resolve tier prices for items
      const resolvedItems: any[] = [];
      for (const item of d.items) {
        const tier = await resolveTierPrice(companyId, item.item_id, item.quantity);
        resolvedItems.push({
          ...item,
          unit_price: item.unit_price || tier.price,
          tier_applied: tier.tierName,
        });
      }

      const totals = calculateInvoiceTotals(resolvedItems, gstType, d.discount_type || 'none', d.discount_value || 0);

      const orderRes = await client.query(
        `INSERT INTO wholesale_orders (
          company_id, godown_id, order_number, order_date, expected_delivery, party_id,
          party_name_snapshot, party_gstin_snapshot, billing_address_snapshot, shipping_address_snapshot,
          place_of_supply, is_interstate,
          subtotal, discount_type, discount_value, discount_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, total_amount,
          status, notes, terms_and_conditions, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'draft',$22,$23,$24) RETURNING *`,
        [
          companyId, d.godown_id || null, orderNumber,
          d.order_date || new Date().toISOString().split('T')[0], d.expected_delivery || null,
          d.party_id, party.name, party.gstin || null,
          party.billing_address || null, d.shipping_address || party.shipping_address || null,
          d.place_of_supply || party.state_code || null, gstType === 'inter',
          totals.subtotal, d.discount_type || 'none', d.discount_value || 0,
          totals.globalDiscountAmount, totals.totalTaxable,
          totals.totalCgst, totals.totalSgst, totals.totalIgst, totals.totalAmount,
          d.notes || null, d.terms_and_conditions || null, req.user!.id
        ]
      );
      const order = orderRes.rows[0];

      for (let i = 0; i < resolvedItems.length; i++) {
        const item = resolvedItems[i];
        const itemTax = calculateInvoiceTotals([item], gstType, 'none', 0);
        const iRes = await client.query('SELECT name, hsn_code FROM items WHERE id = $1', [item.item_id]);
        await client.query(
          `INSERT INTO wholesale_order_items (
            order_id, company_id, item_id, item_name, item_description, hsn_code, unit, quantity, unit_price,
            discount_type, discount_value, discount_amount, taxable_amount,
            gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount, tier_applied, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            order.id, companyId, item.item_id, item.item_name || iRes.rows[0]?.name || 'Item',
            item.item_description || null, item.hsn_code || iRes.rows[0]?.hsn_code || null,
            item.unit || 'PCS', item.quantity, item.unit_price,
            item.discount_type || 'none', item.discount_value || 0,
            itemTax.totalDiscountLineLevel, itemTax.totalTaxable,
            item.gst_rate || 0, itemTax.totalCgst, itemTax.totalSgst, itemTax.totalIgst,
            itemTax.totalAmount, item.tier_applied || null, i + 1
          ]
        );
      }
      return order;
    });

    await logAction(req.user!.id, companyId, 'create', 'wholesale_order', result.id);
    res.status(201).json(success(result));
  } catch (err: any) { res.status(/not found/i.test(err?.message) ? 404 : 400).json(error(err.message)); }
}

// ── GET /api/wholesale ────────────────────────────────────────
export async function listWholesaleOrders(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { page, limit, offset } = parsePagination(req.query);
    const { status, search, party_id } = req.query;
    let where = 'wo.company_id = $1 AND wo.is_deleted = false';
    const params: any[] = [companyId]; let idx = 2;
    if (status) { where += ` AND wo.status = $${idx}`; params.push(status); idx++; }
    if (party_id) { where += ` AND wo.party_id = $${idx}`; params.push(party_id); idx++; }
    if (search) { where += ` AND (wo.order_number ILIKE $${idx} OR wo.party_name_snapshot ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const countRes = await query(`SELECT COUNT(*) FROM wholesale_orders wo WHERE ${where}`, params);
    const result = await query(
      `SELECT wo.*, p.name as party_name, g.name as godown_name,
              (SELECT COUNT(*)::int FROM wholesale_order_items WHERE order_id = wo.id) as item_count
       FROM wholesale_orders wo LEFT JOIN parties p ON wo.party_id = p.id LEFT JOIN godowns g ON wo.godown_id = g.id
       WHERE ${where} ORDER BY wo.order_date DESC, wo.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    // Summary stats
    const statsRes = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
              COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
              COUNT(*) FILTER (WHERE status = 'dispatched') as dispatched_count,
              COUNT(*) FILTER (WHERE status = 'delivered') as delivered_count,
              COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0) as delivered_value
       FROM wholesale_orders WHERE company_id = $1 AND is_deleted = false`, [companyId]
    );
    res.json(success(buildPaginatedResponse(result.rows, parseInt(countRes.rows[0].count), page, limit), statsRes.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/wholesale/:id ────────────────────────────────────
export async function getWholesaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const orderRes = await query(
      `SELECT wo.*, p.name as party_name, p.phone as party_phone, p.gstin as party_gstin, g.name as godown_name
       FROM wholesale_orders wo LEFT JOIN parties p ON wo.party_id = p.id LEFT JOIN godowns g ON wo.godown_id = g.id
       WHERE wo.id = $1 AND wo.company_id = $2 AND wo.is_deleted = false`, [req.params.id, companyId]
    );
    if (!orderRes.rows.length) return res.status(404).json(error('Order not found'));
    const itemsRes = await query('SELECT * FROM wholesale_order_items WHERE order_id = $1 ORDER BY sort_order', [req.params.id]);
    res.json(success({ ...orderRes.rows[0], items: itemsRes.rows }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── PATCH /api/wholesale/:id ──────────────────────────────────
export async function updateWholesaleOrder(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const orderId = req.params.id; const d = req.body;
    const result = await withTransaction(async (client) => {
      const existing = await client.query('SELECT status FROM wholesale_orders WHERE id = $1 AND company_id = $2 AND is_deleted = false FOR UPDATE', [orderId, companyId]);
      if (!existing.rows.length) throw new Error('Order not found');
      if (existing.rows[0].status !== 'draft') throw new Error('Only draft orders can be edited');

      if (d.party_id && Array.isArray(d.items) && d.items.length) {
        const pRes = await client.query('SELECT state_code, name, gstin FROM parties WHERE id = $1', [d.party_id]);
        if (!pRes.rows.length) throw new Error('Party not found');
        const cRes = await client.query('SELECT state_code FROM companies WHERE id = $1', [companyId]);
        const gstType = determineGSTType(pRes.rows[0].state_code, cRes.rows[0].state_code);
        const totals = calculateInvoiceTotals(d.items, gstType, d.discount_type || 'none', d.discount_value || 0);

        await client.query(
          `UPDATE wholesale_orders SET party_id=$1, party_name_snapshot=$2, party_gstin_snapshot=$3, godown_id=$4,
           expected_delivery=$5, subtotal=$6, discount_amount=$7, taxable_amount=$8,
           cgst_amount=$9, sgst_amount=$10, igst_amount=$11, total_amount=$12, notes=$13
           WHERE id=$14 AND company_id=$15`,
          [d.party_id, pRes.rows[0].name, pRes.rows[0].gstin, d.godown_id || null,
           d.expected_delivery || null, totals.subtotal, totals.globalDiscountAmount, totals.totalTaxable,
           totals.totalCgst, totals.totalSgst, totals.totalIgst, totals.totalAmount,
           d.notes || null, orderId, companyId]
        );

        await client.query('DELETE FROM wholesale_order_items WHERE order_id = $1', [orderId]);
        for (let i = 0; i < d.items.length; i++) {
          const item = d.items[i];
          const itemTax = calculateInvoiceTotals([item], gstType, 'none', 0);
          await client.query(
            `INSERT INTO wholesale_order_items (order_id, company_id, item_id, item_name, hsn_code, unit, quantity, unit_price,
              taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, total_amount, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [orderId, companyId, item.item_id, item.item_name || 'Item', item.hsn_code, item.unit || 'PCS',
             item.quantity, item.unit_price, itemTax.totalTaxable, item.gst_rate || 0,
             itemTax.totalCgst, itemTax.totalSgst, itemTax.totalIgst, itemTax.totalAmount, i + 1]
          );
        }
      }
      return (await client.query('SELECT * FROM wholesale_orders WHERE id = $1', [orderId])).rows[0];
    });
    res.json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── POST /api/wholesale/:id/confirm ───────────────────────────
export async function confirmWholesaleOrder(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE wholesale_orders SET status = 'confirmed' WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING id",
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(400).json(error('Cannot confirm — order is not in draft status'));
    res.json(success({ message: 'Order confirmed' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/wholesale/:id/dispatch ──────────────────────────
export async function dispatchWholesaleOrder(req: Request, res: Response) {
  try {
    const d = req.body;
    const companyId = req.user!.company_id;

    const result = await withTransaction(async (client) => {
      const orderRes = await client.query(
        "SELECT * FROM wholesale_orders WHERE id = $1 AND company_id = $2 AND status = 'confirmed' FOR UPDATE",
        [req.params.id, companyId]
      );
      if (!orderRes.rows.length) throw new Error('Order not in confirmed status');
      const order = orderRes.rows[0];

      // Reduce stock
      const itemsRes = await client.query('SELECT * FROM wholesale_order_items WHERE order_id = $1', [order.id]);
      const godownId = order.godown_id;
      if (godownId) {
        for (const item of itemsRes.rows) {
          if (!item.item_id) continue;
          const stockRes = await client.query(
            'SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2 AND company_id = $3 FOR UPDATE',
            [item.item_id, godownId, companyId]
          );
          const available = stockRes.rows[0]?.quantity || 0;
          if (available < item.quantity) throw new Error(`Insufficient stock for "${item.item_name}": available ${available}, need ${item.quantity}`);
          await client.query('UPDATE item_stock SET quantity = quantity - $1 WHERE item_id = $2 AND godown_id = $3 AND company_id = $4',
            [item.quantity, item.item_id, godownId, companyId]);
          const balRes = await client.query('SELECT quantity FROM item_stock WHERE item_id = $1 AND godown_id = $2', [item.item_id, godownId]);
          await client.query(
            `INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, reference_id, quantity, balance_after, notes, created_by)
             VALUES ($1,$2,$3,'wholesale_dispatch','wholesale_order',$4,$5,$6,$7,$8)`,
            [companyId, item.item_id, godownId, order.id, -Number(item.quantity), balRes.rows[0]?.quantity || 0,
             `Dispatched for wholesale order ${order.order_number}`, req.user!.id]
          );
        }
      }

      await client.query(
        `UPDATE wholesale_orders SET status = 'dispatched', dispatch_date = $1, transport_details = $2,
         lr_number = $3, eway_bill_number = $4, vehicle_number = $5 WHERE id = $6`,
        [d.dispatch_date || new Date().toISOString().split('T')[0], d.transport_details || null,
         d.lr_number || null, d.eway_bill_number || null, d.vehicle_number || null, order.id]
      );

      // Update party ledger
      await client.query('UPDATE parties SET balance = balance + $1 WHERE id = $2', [order.total_amount, order.party_id]);
      await client.query(
        `INSERT INTO party_ledger (company_id, party_id, type, amount, balance_after, reference_type, reference_id, narration, created_by)
         VALUES ($1,$2,'debit',$3,(SELECT balance FROM parties WHERE id = $2),'wholesale_order',$4,$5,$6)`,
        [companyId, order.party_id, order.total_amount, order.id, `Wholesale Order ${order.order_number}`, req.user!.id]
      );
      return { message: 'Order dispatched' };
    });
    res.json(success(result));
  } catch (err: any) { res.status(400).json(error(err.message)); }
}

// ── POST /api/wholesale/:id/deliver ───────────────────────────
export async function deliverWholesaleOrder(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE wholesale_orders SET status = 'delivered' WHERE id = $1 AND company_id = $2 AND status = 'dispatched' RETURNING id",
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(400).json(error('Cannot deliver — order is not in dispatched status'));
    res.json(success({ message: 'Order delivered' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── POST /api/wholesale/:id/cancel ────────────────────────────
export async function cancelWholesaleOrder(req: Request, res: Response) {
  try {
    const result = await query(
      "UPDATE wholesale_orders SET status = 'cancelled' WHERE id = $1 AND company_id = $2 AND status IN ('draft','confirmed') RETURNING id",
      [req.params.id, req.user!.company_id]
    );
    if (!result.rows.length) return res.status(400).json(error('Cannot cancel — only draft/confirmed orders can be cancelled'));
    res.json(success({ message: 'Order cancelled' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── Price Tiers ───────────────────────────────────────────────
export async function listPriceTiers(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { item_id } = req.query;
    let where = 'wpt.company_id = $1';
    const params: any[] = [companyId]; let idx = 2;
    if (item_id) { where += ` AND wpt.item_id = $${idx}`; params.push(item_id); idx++; }
    const result = await query(
      `SELECT wpt.*, i.name as item_name, i.sku as item_sku, i.selling_price as base_price
       FROM wholesale_price_tiers wpt LEFT JOIN items i ON wpt.item_id = i.id
       WHERE ${where} ORDER BY i.name, wpt.min_quantity`, params
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function upsertPriceTiers(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id; const d = req.body;
    if (!d.item_id) return res.status(400).json(error('Item is required'));
    if (!Array.isArray(d.tiers) || !d.tiers.length) return res.status(400).json(error('Tiers are required'));

    await withTransaction(async (client) => {
      await client.query('DELETE FROM wholesale_price_tiers WHERE company_id = $1 AND item_id = $2', [companyId, d.item_id]);
      for (const tier of d.tiers) {
        await client.query(
          `INSERT INTO wholesale_price_tiers (company_id, item_id, min_quantity, price, tier_name)
           VALUES ($1,$2,$3,$4,$5)`,
          [companyId, d.item_id, tier.min_quantity, tier.price, tier.tier_name || null]
        );
      }
    });
    res.json(success({ message: 'Price tiers updated' }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
