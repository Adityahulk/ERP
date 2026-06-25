import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

// ═══════════════════════════════════════════════════════════════
// HOLD / RESUME / VOID BILL
// ═══════════════════════════════════════════════════════════════
export async function listHeldBills(req: Request, res: Response) {
  try {
    const rows = await query(
      `SELECT hb.*, u.name AS held_by_name FROM pos_held_bills hb
       LEFT JOIN users u ON u.id = hb.held_by
       WHERE hb.company_id = $1 AND hb.status = 'held' ORDER BY hb.created_at DESC`,
      [req.user!.company_id],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function holdBill(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { label, party_id, party_name, cart, godown_id } = req.body;
    if (!Array.isArray(cart) || !cart.length) return res.status(400).json(error('Cart is empty — nothing to hold'));
    const result = await query(
      `INSERT INTO pos_held_bills (company_id, godown_id, label, party_id, party_name, cart_json, held_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [companyId, godown_id || null, label || null, party_id || null, party_name || null, JSON.stringify(cart), req.user!.id],
    );
    res.status(201).json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function resumeBill(req: Request, res: Response) {
  try {
    const result = await query(
      `UPDATE pos_held_bills SET status = 'resumed', resumed_at = now()
       WHERE id = $1 AND company_id = $2 AND status = 'held' RETURNING *`,
      [req.params.id, req.user!.company_id],
    );
    if (!result.rows.length) return res.status(404).json(error('Held bill not found (it may have already been resumed)'));
    res.json(success(result.rows[0]));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function voidHeldBill(req: Request, res: Response) {
  try {
    const result = await query(
      `UPDATE pos_held_bills SET status = 'voided' WHERE id = $1 AND company_id = $2 AND status = 'held' RETURNING id`,
      [req.params.id, req.user!.company_id],
    );
    if (!result.rows.length) return res.status(404).json(error('Held bill not found'));
    res.json(success({ voided: true }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// POS REPORTS — real, from the same invoices created by checkout.
// There's no separate pos_sales table; POS checkout creates a normal
// sale invoice, so these reports query invoices directly.
// ═══════════════════════════════════════════════════════════════
function rangeFromQuery(req: Request) {
  const to = String(req.query.to_date || new Date().toISOString().split('T')[0]);
  const from = String(req.query.from_date || to);
  return { from, to };
}

export async function cashierWiseSales(req: Request, res: Response) {
  try {
    const { from, to } = rangeFromQuery(req);
    const rows = await query(
      `SELECT u.id AS cashier_id, COALESCE(u.name, 'Unknown') AS cashier_name,
              COUNT(*)::int AS invoice_count, SUM(i.total_amount)::bigint AS total_paise
       FROM invoices i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND i.invoice_date >= $2 AND i.invoice_date <= $3
       GROUP BY u.id, u.name ORDER BY total_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function counterWiseSales(req: Request, res: Response) {
  try {
    const { from, to } = rangeFromQuery(req);
    const rows = await query(
      `SELECT g.id AS godown_id, COALESCE(g.name, 'Unassigned') AS counter_name,
              COUNT(*)::int AS invoice_count, SUM(i.total_amount)::bigint AS total_paise
       FROM invoices i LEFT JOIN godowns g ON g.id = i.godown_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND i.invoice_date >= $2 AND i.invoice_date <= $3
       GROUP BY g.id, g.name ORDER BY total_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

export async function hourlyBillingReport(req: Request, res: Response) {
  try {
    const { from, to } = rangeFromQuery(req);
    const rows = await query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS invoice_count, SUM(total_amount)::bigint AS total_paise
       FROM invoices
       WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_date >= $2 AND invoice_date <= $3
       GROUP BY EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata') ORDER BY hour`,
      [req.user!.company_id, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ═══════════════════════════════════════════════════════════════
// POS DASHBOARD WIDGETS — all real, computed from today's real
// invoices (Asia/Kolkata "today", matching the Hourly Billing Report
// fix from the previous POS pass).
// ═══════════════════════════════════════════════════════════════
export async function getDashboardWidgets(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;

    const todaySummary = await query(
      `SELECT COUNT(*)::int AS bill_count, COALESCE(SUM(total_amount), 0)::bigint AS total_sales_paise
       FROM invoices
       WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled'
         AND invoice_type IN ('sale','tax_invoice')
         AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [companyId],
    );
    const billCount = todaySummary.rows[0].bill_count;
    const totalSales = Number(todaySummary.rows[0].total_sales_paise);
    const avgBillValue = billCount > 0 ? Math.round(totalSales / billCount) : 0;

    const topItems = await query(
      `SELECT ii.item_name, SUM(ii.quantity)::numeric AS qty_sold, SUM(ii.total_amount)::bigint AS revenue_paise
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
       GROUP BY ii.item_name ORDER BY qty_sold DESC LIMIT 5`,
      [companyId],
    );

    const topCashiers = await query(
      `SELECT COALESCE(u.name, 'Unknown') AS cashier_name, COUNT(*)::int AS bill_count, SUM(i.total_amount)::bigint AS total_paise
       FROM invoices i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
         AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
       GROUP BY u.name ORDER BY total_paise DESC LIMIT 5`,
      [companyId],
    );

    res.json(success({
      todaySalesPaise: totalSales,
      todayBillCount: billCount,
      averageBillValuePaise: avgBillValue,
      topSellingItems: topItems.rows,
      topCashiers: topCashiers.rows,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
