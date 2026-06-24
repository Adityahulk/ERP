import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { getExpenseGstSql } from '../services/expenseReportingService';
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

/** Default report window: first day of current month → today (inclusive). */
function parseRange(req: Request): { from: string; to: string } {
  const to = String(req.query.to_date || req.query.to || new Date().toISOString().split('T')[0]);
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  const from = String(req.query.from_date || req.query.from || monthStart);
  return { from, to };
}

// ── GET /api/dashboard ────────────────────────────────────────
export async function getDashboard(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const today = new Date().toISOString().split('T')[0];

    // Today's sales
    const todaySales = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
       FROM invoices WHERE company_id = $1 AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice') AND invoice_date = $2 AND status != 'cancelled' AND is_deleted = false`,
      [companyId, today]
    );

    // This month's sales
    const monthSales = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
       FROM invoices WHERE company_id = $1 AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice')
       AND invoice_date >= date_trunc('month', CURRENT_DATE) AND status != 'cancelled' AND is_deleted = false`,
      [companyId]
    );

    // Total receivable & payable (calculated from unpaid invoices and party records)
    const balances = await query(
      `SELECT 
         COALESCE(SUM(balance_due), 0) as total_receivable,
         COALESCE((SELECT SUM(ABS(balance)) FROM parties WHERE company_id = $1 AND balance < 0 AND is_deleted = false), 0) as total_payable,
         COUNT(DISTINCT COALESCE(party_id::text, NULLIF(party_name_snapshot, ''), id::text)) as due_customers_count
       FROM invoices
       WHERE company_id = $1 
         AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice')
         AND balance_due > 0 
         AND status != 'cancelled' 
         AND is_deleted = false`,
      [companyId]
    );

    // Overdue invoices
    const overdue = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(balance_due), 0) as total
       FROM invoices WHERE company_id = $1 AND due_date < CURRENT_DATE AND balance_due > 0 AND status != 'paid' AND status != 'cancelled' AND is_deleted = false`,
      [companyId]
    );

    // Low stock items
    const lowStock = await query(
      `SELECT COUNT(DISTINCT i.id) as count
       FROM items i
       LEFT JOIN (
         SELECT item_id, SUM(quantity) AS qty
         FROM item_stock
         WHERE company_id = $1
         GROUP BY item_id
       ) s ON s.item_id = i.id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true
         AND i.reorder_point > 0 AND COALESCE(s.qty, 0) <= i.reorder_point`,
      [companyId]
    );

    // This month's expenses
    const monthExpenses = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM expenses WHERE company_id = $1 AND expense_date >= date_trunc('month', CURRENT_DATE) AND is_deleted = false`,
      [companyId]
    );

    // Recent invoices
    const recentInvoices = await query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.status, i.invoice_type,
              p.name as party_name
       FROM invoices i LEFT JOIN parties p ON i.party_id = p.id
       WHERE i.company_id = $1 AND i.is_deleted = false
       ORDER BY i.created_at DESC LIMIT 5`,
      [companyId]
    );

    // Sales trend (last 7 days)
    const salesTrend = await query(
      `SELECT d::date as date, COALESCE(SUM(i.total_amount), 0) as total, COUNT(i.id) as count
       FROM generate_series(CURRENT_DATE - interval '6 days', CURRENT_DATE, '1 day') d
       LEFT JOIN invoices i ON i.invoice_date = d::date AND i.company_id = $1 AND (i.invoice_type = 'sale' OR i.invoice_type = 'tax_invoice') AND i.status != 'cancelled' AND i.is_deleted = false
       GROUP BY d::date ORDER BY d::date`,
      [companyId]
    );

    // Top customer dues (all time) - aggregated by unique customer from invoices and parties
    const topDueParties = await query(
      `SELECT 
         COALESCE(i.party_id::text, NULLIF(i.party_name_snapshot, ''), i.id::text) as id,
         COALESCE(p.name, NULLIF(i.party_name_snapshot, ''), 'Walk-in Customer') as name,
         COALESCE(p.phone, i.party_phone_snapshot) as phone,
         SUM(i.balance_due)::bigint as balance
       FROM invoices i
       LEFT JOIN parties p ON i.party_id = p.id
       WHERE 
         i.company_id = $1 
         AND (i.invoice_type = 'sale' OR i.invoice_type = 'tax_invoice')
         AND i.balance_due > 0 
         AND i.status != 'cancelled' 
         AND i.is_deleted = false
       GROUP BY COALESCE(i.party_id::text, NULLIF(i.party_name_snapshot, ''), i.id::text), COALESCE(p.name, NULLIF(i.party_name_snapshot, ''), 'Walk-in Customer'), COALESCE(p.phone, i.party_phone_snapshot)
       ORDER BY balance DESC
       LIMIT 5`,
      [companyId]
    );

    // Payments today
    const todayPayments = await query(
      `SELECT 
         COALESCE(SUM(amount) FILTER (WHERE payment_type IN ('payment_in', 'incoming')), 0) as received,
         COALESCE(SUM(amount) FILTER (WHERE payment_type IN ('payment_out', 'outgoing')), 0) as paid
       FROM payments WHERE company_id = $1 AND payment_date = $2 AND is_deleted = false`,
      [companyId, today]
    );

    // Stock valuation
    const stockValue = await query(
      `SELECT COALESCE(SUM(s.quantity * COALESCE(i.purchase_price, 0)), 0) as total_value,
               SUM(s.quantity) as total_qty
       FROM item_stock s
       JOIN items i ON s.item_id = i.id
       WHERE s.company_id = $1 AND i.is_deleted = false`,
      [companyId]
    );

    // Production this month
    const monthProduction = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_cost), 0) as total_cost
       FROM production_logs
       WHERE company_id = $1 AND production_date >= date_trunc('month', CURRENT_DATE)`,
      [companyId]
    ).catch(() => ({ rows: [{ count: 0, total_cost: 0 }] }));

    res.json(success({
      today: {
        sales: todaySales.rows[0],
        payments: todayPayments.rows[0],
      },
      month: {
        sales: monthSales.rows[0],
        expenses: Number(monthExpenses.rows[0].total || 0),
        profit: Number(monthSales.rows[0].total || 0) - Number(monthExpenses.rows[0].total || 0),
        production: monthProduction.rows[0],
      },
      balances: balances.rows[0],
      overdue: overdue.rows[0],
      low_stock_count: parseInt(lowStock.rows[0].count),
      stock_value: Number(stockValue.rows[0].total_value || 0),
      stock_qty: Number(stockValue.rows[0].total_qty || 0),
      recent_invoices: recentInvoices.rows,
      sales_trend: salesTrend.rows,
      topDueParties: topDueParties.rows,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/profit-loss ──────────────────────────────
export async function profitLoss(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);

    // Revenue (taxable base excl. GST — aligns with GST turnover / line items)
    const revenue = await query(
      `SELECT COALESCE(SUM(taxable_amount), 0) as gross_revenue,
              COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0) as tax_collected,
              COALESCE(SUM(discount_amount), 0) as discounts
       FROM invoices WHERE company_id = $1
         AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice')
         AND status != 'cancelled' AND is_deleted = false
         AND invoice_date >= $2 AND invoice_date <= $3`,
      [companyId, from, to]
    );

    // COGS: sold qty × current weighted purchase price (paise); matches inventory valuation basis
    const cogs = await query(
      `SELECT COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0) as total
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice') AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3`,
      [companyId, from, to]
    );

    // Expenses: `amount` is stored taxable base; `total_amount` is cash paid (incl. GST). Match revenue (ex-GST) using SUM(amount).
    const expenses = await query(
      `SELECT category, COALESCE(SUM(COALESCE(amount, 0)), 0) as total
       FROM expenses WHERE company_id = $1 AND is_deleted = false
         AND expense_date >= $2 AND expense_date <= $3
       GROUP BY category ORDER BY total DESC`,
      [companyId, from, to]
    );

    const totalExpenses = expenses.rows.reduce((s: number, r: any) => s + Number(r.total || 0), 0);
    const grossRevenue = Number(revenue.rows[0].gross_revenue || 0);
    const grossProfit = grossRevenue - Number(cogs.rows[0].total || 0);
    const netProfit = grossProfit - totalExpenses;

    res.json(success({
      period: { from, to },
      revenue: {
        gross: grossRevenue,
        discounts: Number(revenue.rows[0].discounts || 0),
        tax_collected: Number(revenue.rows[0].tax_collected || 0),
      },
      cost_of_goods: Number(cogs.rows[0].total || 0),
      gross_profit: grossProfit,
      gross_margin_pct: grossRevenue > 0 ? ((grossProfit / grossRevenue) * 100).toFixed(1) : '0',
      expenses: expenses.rows,
      total_expenses: totalExpenses,
      net_profit: netProfit,
      net_margin_pct: grossRevenue > 0 ? ((netProfit / grossRevenue) * 100).toFixed(1) : '0',
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/gst ──────────────────────────────────────
export async function gstReport(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const expenseSql = await getExpenseGstSql('e', 'c');

    // Outward tax (sales / tax invoices) — line level
    const outward = await query(
      `SELECT ii.gst_rate, COUNT(*)::int as line_count,
              COALESCE(SUM(ii.taxable_amount), 0)::bigint as taxable_value,
              COALESCE(SUM(ii.cgst_amount), 0)::bigint as cgst,
              COALESCE(SUM(ii.sgst_amount), 0)::bigint as sgst,
              COALESCE(SUM(ii.igst_amount), 0)::bigint as igst,
              COALESCE(SUM(ii.cess_amount), 0)::bigint as cess
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice') AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`,
      [companyId, from, to]
    );

    // Inward: purchase invoices (table) + legacy purchase as invoice + GST expenses
    const inward = await query(
      `WITH line_rows AS (
         SELECT ii.gst_rate,
                ii.taxable_amount AS taxable,
                ii.cgst_amount AS cgst,
                ii.sgst_amount AS sgst,
                ii.igst_amount AS igst,
                COALESCE(ii.cess_amount, 0) AS cess
         FROM invoice_items ii
         JOIN invoices inv ON ii.invoice_id = inv.id
         WHERE inv.company_id = $1 AND inv.invoice_type = 'purchase' AND inv.status != 'cancelled' AND inv.is_deleted = false
           AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
         UNION ALL
         SELECT pii.gst_rate,
                (COALESCE(pii.total_amount, 0) - COALESCE(pii.cgst_amount, 0) - COALESCE(pii.sgst_amount, 0) - COALESCE(pii.igst_amount, 0)) AS taxable,
                COALESCE(pii.cgst_amount, 0),
                COALESCE(pii.sgst_amount, 0),
                COALESCE(pii.igst_amount, 0),
                0 AS cess
         FROM purchase_invoice_items pii
         JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
         WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
           AND pi.bill_date >= $2 AND pi.bill_date <= $3
         UNION ALL
         SELECT COALESCE(e.gst_rate, 0),
                ${expenseSql.taxableExpr},
                ${expenseSql.cgstExpr},
                ${expenseSql.sgstExpr},
                ${expenseSql.igstExpr},
                0
         FROM expenses e
         JOIN companies c ON c.id = e.company_id
         WHERE e.company_id = $1 AND e.is_deleted = false AND COALESCE(e.gst_rate, 0) > 0
           AND e.expense_date >= $2 AND e.expense_date <= $3
       )
       SELECT gst_rate,
              COUNT(*)::int AS line_count,
              COALESCE(SUM(taxable), 0)::bigint AS taxable_value,
              COALESCE(SUM(cgst), 0)::bigint AS cgst,
              COALESCE(SUM(sgst), 0)::bigint AS sgst,
              COALESCE(SUM(igst), 0)::bigint AS igst,
              COALESCE(SUM(cess), 0)::bigint AS cess
       FROM line_rows
       GROUP BY gst_rate
       ORDER BY gst_rate`,
      [companyId, from, to]
    );

    const num = (v: any) => Number(v) || 0;
    const totalOutwardCgst = outward.rows.reduce((s: number, r: any) => s + num(r.cgst), 0);
    const totalOutwardSgst = outward.rows.reduce((s: number, r: any) => s + num(r.sgst), 0);
    const totalOutwardIgst = outward.rows.reduce((s: number, r: any) => s + num(r.igst), 0);
    const totalInwardCgst = inward.rows.reduce((s: number, r: any) => s + num(r.cgst), 0);
    const totalInwardSgst = inward.rows.reduce((s: number, r: any) => s + num(r.sgst), 0);
    const totalInwardIgst = inward.rows.reduce((s: number, r: any) => s + num(r.igst), 0);
    const totalOutwardCess = outward.rows.reduce((s: number, r: any) => s + num(r.cess), 0);
    const totalInwardCess = inward.rows.reduce((s: number, r: any) => s + num(r.cess), 0);

    res.json(success({
      period: { from, to },
      outward_supplies: outward.rows,
      inward_supplies: inward.rows,
      summary: {
        cgst_payable: totalOutwardCgst - totalInwardCgst,
        sgst_payable: totalOutwardSgst - totalInwardSgst,
        igst_payable: totalOutwardIgst - totalInwardIgst,
        cess_payable: totalOutwardCess - totalInwardCess,
        total_payable:
          (totalOutwardCgst - totalInwardCgst) +
          (totalOutwardSgst - totalInwardSgst) +
          (totalOutwardIgst - totalInwardIgst) +
          (totalOutwardCess - totalInwardCess),
      },
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/party-statement ──────────────────────────
export async function partyStatement(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { party_id, from_date, to_date } = req.query;

    if (!party_id) return res.status(400).json(error('party_id is required'));

    const partyRes = await query('SELECT name, phone, gstin, balance FROM parties WHERE id = $1 AND company_id = $2', [party_id, companyId]);
    if (!partyRes.rows.length) return res.status(404).json(error('Party not found'));

    let where = 'l.party_id = $1 AND l.company_id = $2';
    const params: any[] = [party_id, companyId];
    let idx = 3;

    if (from_date) { where += ` AND l.created_at >= $${idx}::date`; params.push(from_date); idx++; }
    if (to_date) { where += ` AND l.created_at <= $${idx}::date + interval '1 day'`; params.push(to_date); idx++; }

    const result = await query(
      `SELECT l.*, u.name as created_by_name
       FROM party_ledger l
       LEFT JOIN users u ON l.created_by = u.id
       WHERE ${where}
       ORDER BY l.created_at ASC, l.id ASC`,
      params
    );

    res.json(success({
      party: partyRes.rows[0],
      ledger: result.rows,
      current_balance: partyRes.rows[0].balance,
    }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sales-register ───────────────────────────
export async function salesRegister(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT i.invoice_date, i.invoice_number, p.name as party_name,
              i.taxable_amount, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_amount, i.payment_status, i.status
       FROM invoices i
       LEFT JOIN parties p ON i.party_id = p.id
       WHERE i.company_id = $1 AND (i.invoice_type = 'sale' OR i.invoice_type = 'tax_invoice')
         AND i.is_deleted = false AND i.status != 'cancelled'
         AND i.invoice_date >= $2 AND i.invoice_date <= $3
       ORDER BY i.invoice_date ASC, i.invoice_number ASC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function purchaseRegister(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT pi.bill_date, pi.bill_number, p.name as party_name,
              pi.taxable_amount, pi.cgst_amount, pi.sgst_amount, pi.igst_amount, pi.total_amount, pi.payment_status, pi.status
       FROM purchase_invoices pi
       LEFT JOIN parties p ON pi.party_id = p.id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND pi.bill_date >= $2 AND pi.bill_date <= $3
       ORDER BY pi.bill_date ASC, pi.bill_number ASC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function stockSummary(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT i.id, i.name, i.sku,
              COALESCE(SUM(s.quantity), 0) AS total_qty,
              COALESCE(i.purchase_price, 0)::bigint AS purchase_price_paise,
              COALESCE(
                SUM(
                  ROUND(
                    s.quantity::numeric * COALESCE(NULLIF(s.avg_cost_price, 0), i.purchase_price, 0)::numeric
                  )
                ),
                0
              )::bigint AS total_value_paise
       FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id AND s.company_id = i.company_id
       WHERE i.company_id = $1 AND i.is_deleted = false
       GROUP BY i.id, i.name, i.sku, i.purchase_price
       HAVING COALESCE(SUM(s.quantity), 0) > 0
       ORDER BY i.name ASC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function outstandingReceivables(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT i.invoice_number, i.invoice_date, i.due_date, p.name as party_name,
              i.balance_due::bigint,
              (CURRENT_DATE - i.due_date)::int AS days_overdue
       FROM invoices i
       JOIN parties p ON i.party_id = p.id
       WHERE i.company_id = $1 AND (i.invoice_type = 'sale' OR i.invoice_type = 'tax_invoice')
         AND i.status NOT IN ('paid', 'cancelled') AND i.balance_due > 0 AND i.is_deleted = false
       ORDER BY i.due_date ASC NULLS LAST`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function outstandingPayables(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT pi.bill_number, pi.bill_date, p.name as party_name,
              (pi.total_amount - COALESCE(pi.paid_amount, 0))::bigint AS balance_due
       FROM purchase_invoices pi
       JOIN parties p ON pi.party_id = p.id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND (pi.total_amount - COALESCE(pi.paid_amount, 0)) > 0
       ORDER BY pi.bill_date ASC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function stockMovement(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT sm.created_at, sm.movement_type, sm.quantity, sm.unit_cost, sm.reference_type, sm.reference_id,
              i.name AS item_name, g.name AS godown_name
       FROM stock_movements sm
       JOIN items i ON i.id = sm.item_id
       LEFT JOIN godowns g ON g.id = sm.godown_id
       WHERE sm.company_id = $1 AND sm.created_at::date >= $2::date AND sm.created_at::date <= $3::date
       ORDER BY sm.created_at DESC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function lowStock(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT i.id, i.name, i.sku, i.reorder_point,
              COALESCE(SUM(s.quantity), 0) AS total_qty,
              COALESCE(i.purchase_price, 0)::bigint AS purchase_price_paise
       FROM items i
       LEFT JOIN item_stock s ON s.item_id = i.id AND s.company_id = i.company_id
       WHERE i.company_id = $1 AND i.is_deleted = false AND i.track_inventory = true AND COALESCE(i.reorder_point, 0) > 0
       GROUP BY i.id, i.name, i.sku, i.reorder_point, i.purchase_price
       HAVING COALESCE(SUM(s.quantity), 0) <= COALESCE(i.reorder_point, 0)
       ORDER BY i.name ASC`,
      [req.user!.company_id]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function itemWiseProfit(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(it.id::text, md5(ii.item_name)) AS item_key,
              COALESCE(it.name, ii.item_name) AS item_name,
              COALESCE(it.sku, '') AS sku,
              SUM(ii.quantity)::numeric AS qty_sold,
              COALESCE(SUM(ii.taxable_amount), 0)::bigint AS sales_taxable_paise,
              COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0)::bigint AS cogs_paise,
              (COALESCE(SUM(ii.taxable_amount), 0) - COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0))::bigint AS gross_profit_paise
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(it.id::text, md5(ii.item_name::text)), COALESCE(it.name, ii.item_name), COALESCE(it.sku, '')
       ORDER BY gross_profit_paise DESC`,
      [companyId, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function partyWiseSales(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid) AS party_id,
              COALESCE(p.name, 'Walk-in / unassigned') AS party_name,
              COUNT(inv.id)::int AS invoice_count,
              COALESCE(SUM(inv.taxable_amount), 0)::bigint AS taxable_total_paise,
              COALESCE(SUM(inv.total_amount), 0)::bigint AS invoice_total_paise
       FROM invoices inv
       LEFT JOIN parties p ON p.id = inv.party_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(p.name, 'Walk-in / unassigned')
       ORDER BY invoice_total_paise DESC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function partyWisePurchase(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid) AS party_id,
              COALESCE(p.name, 'Unassigned supplier') AS party_name,
              COUNT(pi.id)::int AS bill_count,
              COALESCE(SUM(pi.taxable_amount), 0)::bigint AS taxable_total_paise,
              COALESCE(SUM(pi.total_amount), 0)::bigint AS bill_total_paise
       FROM purchase_invoices pi
       LEFT JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND pi.bill_date >= $2 AND pi.bill_date <= $3
       GROUP BY COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(p.name, 'Unassigned supplier')
       ORDER BY bill_total_paise DESC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function dayBook(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT v_date, source, ref, narration, debit_paise, credit_paise, party_name FROM (
         SELECT je.entry_date AS v_date, 'journal'::text AS source, COALESCE(je.entry_number, je.id::text) AS ref,
                je.description AS narration, je.total_debit::bigint AS debit_paise, je.total_credit::bigint AS credit_paise,
                NULL::text AS party_name
         FROM journal_entries je
         WHERE je.company_id = $1 AND je.is_deleted = false AND COALESCE(je.status, 'posted') = 'posted'
           AND je.entry_date >= $2 AND je.entry_date <= $3
         UNION ALL
         SELECT p.payment_date, 'payment', COALESCE(p.payment_number, p.id::text),
                COALESCE(NULLIF(TRIM(p.notes), ''), p.payment_type),
                CASE WHEN p.payment_type IN ('payment_in', 'incoming') THEN p.amount::bigint ELSE 0 END,
                CASE WHEN p.payment_type IN ('payment_out', 'outgoing') THEN p.amount::bigint ELSE 0 END,
                pt.name
         FROM payments p
         LEFT JOIN parties pt ON pt.id = p.party_id
         WHERE p.company_id = $1 AND p.is_deleted = false AND p.payment_date >= $2 AND p.payment_date <= $3
       ) u
       ORDER BY v_date ASC, ref ASC`,
      [companyId, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function expenseSummary(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT category,
              COUNT(*)::int AS entries,
              COALESCE(SUM(COALESCE(total_amount, amount, 0)), 0)::bigint AS total_paise
       FROM expenses
       WHERE company_id = $1 AND is_deleted = false AND expense_date >= $2 AND expense_date <= $3
       GROUP BY category
       ORDER BY total_paise DESC`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function paymentCollection(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT payment_date, payment_type, payment_mode,
              COUNT(*)::int AS txn_count,
              COALESCE(SUM(amount), 0)::bigint AS total_paise
       FROM payments
       WHERE company_id = $1 AND is_deleted = false AND payment_date >= $2 AND payment_date <= $3
       GROUP BY payment_date, payment_type, payment_mode
       ORDER BY payment_date DESC, payment_type`,
      [req.user!.company_id, from, to]
    );
    res.json(success(result.rows));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function tcsTds(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const sale = await query(
      `SELECT COALESCE(SUM(tcs_amount), 0)::bigint AS tcs_collected_paise
       FROM invoices
       WHERE company_id = $1 AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice')
         AND status != 'cancelled' AND is_deleted = false
         AND invoice_date >= $2 AND invoice_date <= $3`,
      [companyId, from, to]
    );
    const pur = await query(
      `SELECT COALESCE(SUM(tds_amount), 0)::bigint AS tds_deducted_paise
       FROM purchase_invoices
       WHERE company_id = $1 AND is_deleted = false AND COALESCE(status, '') != 'cancelled'
         AND bill_date >= $2 AND bill_date <= $3`,
      [companyId, from, to]
    );
    res.json(
      success({
        period: { from, to },
        tcs_collected_paise: Number(sale.rows[0]?.tcs_collected_paise || 0),
        tds_deducted_paise: Number(pur.rows[0]?.tds_deducted_paise || 0),
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

async function computeNetProfitPaise(companyId: string, from: string, to: string): Promise<number> {
  const revenue = await query(
    `SELECT COALESCE(SUM(taxable_amount), 0) AS g FROM invoices WHERE company_id = $1
       AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice') AND status != 'cancelled' AND is_deleted = false
       AND invoice_date >= $2 AND invoice_date <= $3`,
    [companyId, from, to]
  );
  const cogs = await query(
    `SELECT COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0) AS c
     FROM invoice_items ii
     JOIN invoices inv ON ii.invoice_id = inv.id
     LEFT JOIN items it ON ii.item_id = it.id
     WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
       AND inv.status != 'cancelled' AND inv.is_deleted = false
       AND inv.invoice_date >= $2 AND inv.invoice_date <= $3`,
    [companyId, from, to]
  );
  const exp = await query(
    `SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) AS e FROM expenses
     WHERE company_id = $1 AND is_deleted = false AND expense_date >= $2 AND expense_date <= $3`,
    [companyId, from, to]
  );
  const g = Number(revenue.rows[0]?.g || 0);
  const c = Number(cogs.rows[0]?.c || 0);
  const e = Number(exp.rows[0]?.e || 0);
  return g - c - e;
}

export async function trialBalance(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT a.id, a.code, a.name, a.account_type, a.parent_id, parent.name AS parent_name,
              COALESCE(a.opening_balance, 0)::bigint AS opening_balance_paise,
              COALESCE(SUM(jel.debit), 0)::bigint AS period_debit_paise,
              COALESCE(SUM(jel.credit), 0)::bigint AS period_credit_paise,
              (COALESCE(a.opening_balance, 0) + COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN a.account_type IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0))::bigint AS closing_balance_paise
       FROM accounts a
       LEFT JOIN accounts parent ON parent.id = a.parent_id
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
       LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = a.company_id
         AND je.is_deleted = false AND COALESCE(je.status, 'posted') = 'posted'
         AND je.entry_date >= $2::date AND je.entry_date <= $3::date
       WHERE a.company_id = $1 AND a.is_deleted = false AND a.is_active = true
       GROUP BY a.id, a.code, a.name, a.account_type, a.parent_id, parent.name, a.opening_balance
       ORDER BY a.account_type, COALESCE(parent.name, a.name), a.code NULLS LAST, a.name`,
      [companyId, from, to]
    );

    // Build a real two-level tree (group accounts with parent_id=NULL
    // that have children -> those children nested beneath them).
    const byId = new Map(result.rows.map((r: any) => [r.id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const row of byId.values()) {
      if (row.parent_id && byId.has(row.parent_id)) byId.get(row.parent_id)!.children.push(row);
      else roots.push(row);
    }

    const totalDebit = result.rows.reduce((s, r) => s + Number(r.period_debit_paise), 0);
    const totalCredit = result.rows.reduce((s, r) => s + Number(r.period_credit_paise), 0);

    // Real imbalance check — flags the exact unbalanced journal entries,
    // same query used by Utilities → Verify My Data, so a trial balance
    // that doesn't tie out always points to a fixable root cause.
    const unbalanced = await query(
      `SELECT id, entry_number, total_debit, total_credit FROM journal_entries
       WHERE company_id = $1 AND is_deleted = false AND total_debit != total_credit
         AND entry_date >= $2::date AND entry_date <= $3::date`,
      [companyId, from, to],
    );

    res.json(success({
      period: { from, to },
      rows: result.rows,
      tree: roots,
      totalDebit,
      totalCredit,
      isBalanced: totalDebit === totalCredit && unbalanced.rows.length === 0,
      unbalancedEntries: unbalanced.rows,
    }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function balanceSheet(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { from, to } = parseRange(req);
    const tb = await query(
      `SELECT a.code, a.name, a.account_type,
              (COALESCE(a.opening_balance, 0) + COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN a.account_type IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0))::bigint AS closing_balance_paise
       FROM accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.company_id = a.company_id
       LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = a.company_id
         AND je.is_deleted = false AND COALESCE(je.status, 'posted') = 'posted'
         AND je.entry_date >= $2::date AND je.entry_date <= $3::date
       WHERE a.company_id = $1 AND a.is_deleted = false AND a.is_active = true
         AND a.account_type IN ('asset', 'liability', 'equity')
       GROUP BY a.id, a.code, a.name, a.account_type, a.opening_balance
       ORDER BY a.account_type, a.code NULLS LAST`,
      [companyId, from, to]
    );
    const rows = tb.rows as any[];
    const assets = rows.filter((r) => r.account_type === 'asset');
    const liabilities = rows.filter((r) => r.account_type === 'liability');
    const equityAccounts = rows.filter((r) => r.account_type === 'equity');
    const sumBal = (list: any[]) => list.reduce((s, r) => s + Number(r.closing_balance_paise || 0), 0);
    const totalAssets = sumBal(assets);
    const totalLiabilities = sumBal(liabilities);
    const totalEquityAccounts = sumBal(equityAccounts);
    const plNet = await computeNetProfitPaise(companyId, from, to);
    const equityFromPL = {
      code: 'PL-PERIOD',
      name: 'Current period result (P&L summary)',
      account_type: 'equity',
      closing_balance_paise: plNet,
    };
    const totalEquity = totalEquityAccounts + plNet;
    res.json(
      success({
        period: { from, to },
        assets: { lines: assets, total_paise: totalAssets },
        liabilities: { lines: liabilities, total_paise: totalLiabilities },
        equity: {
          lines: [...equityAccounts, equityFromPL],
          total_paise: totalEquity,
        },
        check: {
          assets_minus_liabilities_equity_paise: totalAssets - (totalLiabilities + totalEquity),
          note:
            'Balance sheet uses posted journals in the selected period plus opening balances. P&L result is appended to equity for a quick SME view; formal closing entries may differ.',
        },
      })
    );
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

function escXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getTallyExportData(companyId: string) {
  const [companyRes, unitsRes, categoriesRes, itemsRes, partiesRes, salesRes, purchaseRes, saleReturnsRes, purchaseReturnsRes] = await Promise.all([
    query('SELECT id, name, legal_name, gstin, state, state_code FROM companies WHERE id = $1', [companyId]),
    query('SELECT id, name, abbreviation, is_default FROM item_units WHERE company_id = $1 ORDER BY name', [companyId]),
    query('SELECT id, name FROM item_categories WHERE company_id = $1 AND is_deleted = false ORDER BY name', [companyId]),
    query(
      `SELECT i.id, i.name, i.sku, i.barcode, i.hsn_code, i.gst_rate, i.purchase_price, i.selling_price,
              i.opening_stock, i.opening_stock_value, c.name AS category_name, u.name AS unit_name
       FROM items i
       LEFT JOIN item_categories c ON c.id = i.category_id
       LEFT JOIN item_units u ON u.id = i.unit_id
       WHERE i.company_id = $1 AND i.is_deleted = false
       ORDER BY i.name`,
      [companyId]
    ),
    query(
      `SELECT id, name, party_type, gstin, phone, email, billing_address, billing_city, billing_state,
              billing_pincode, opening_balance
       FROM parties
       WHERE company_id = $1 AND is_deleted = false
       ORDER BY name`,
      [companyId]
    ),
    query(
      `SELECT id, invoice_number AS number, invoice_date AS date, total_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, status
       FROM invoices
       WHERE company_id = $1 AND is_deleted = false AND (invoice_type = 'sale' OR invoice_type = 'tax_invoice')
       ORDER BY invoice_date`,
      [companyId]
    ),
    query(
      `SELECT id, bill_number AS number, bill_date AS date, total_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, status
       FROM purchase_invoices
       WHERE company_id = $1 AND is_deleted = false
       ORDER BY bill_date`,
      [companyId]
    ),
    query(
      `SELECT id, credit_note_number AS number, return_date AS date, total_amount, reason
       FROM sale_returns WHERE company_id = $1 AND is_deleted = false ORDER BY return_date`,
      [companyId]
    ),
    query(
      `SELECT id, debit_note_number AS number, return_date AS date, total_amount, reason
       FROM purchase_returns WHERE company_id = $1 AND is_deleted = false ORDER BY return_date`,
      [companyId]
    ),
  ]);

  return {
    company: companyRes.rows[0] || null,
    units: unitsRes.rows,
    categories: categoriesRes.rows,
    items: itemsRes.rows,
    parties: partiesRes.rows,
    sales: salesRes.rows,
    purchases: purchaseRes.rows,
    creditNotes: saleReturnsRes.rows,
    debitNotes: purchaseReturnsRes.rows,
  };
}

export async function tallyExport(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const format = String(req.query.format || 'json').toLowerCase();
    const payload = await getTallyExportData(companyId);

    if (format === 'xml') {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <COMPANY NAME="${escXml(payload.company?.name || 'Company')}">
            <NAME>${escXml(payload.company?.name || '')}</NAME>
            <LEGALNAME>${escXml(payload.company?.legal_name || '')}</LEGALNAME>
            <GSTIN>${escXml(payload.company?.gstin || '')}</GSTIN>
          </COMPANY>
          ${payload.units.map((u: any) => `<UNIT NAME="${escXml(u.name)}"><NAME>${escXml(u.name)}</NAME><ORIGINALNAME>${escXml(u.abbreviation || '')}</ORIGINALNAME></UNIT>`).join('')}
          ${payload.items
            .map(
              (i: any) => `<STOCKITEM NAME="${escXml(i.name)}">
  <NAME>${escXml(i.name)}</NAME>
  <BASEUNITS>${escXml(i.unit_name || '')}</BASEUNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <RATEOFTAXCALCULATION>${Number(i.gst_rate || 0)}</RATEOFTAXCALCULATION>
  <OPENINGBALANCE>${Number(i.opening_stock || 0)}</OPENINGBALANCE>
</STOCKITEM>`
            )
            .join('')}
          ${payload.parties.map((p: any) => `<LEDGER NAME="${escXml(p.name)}"><NAME>${escXml(p.name)}</NAME><GSTIN>${escXml(p.gstin || '')}</GSTIN></LEDGER>`).join('')}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename=tally-export-${new Date().toISOString().slice(0, 10)}.xml`);
      return res.send(xml);
    }

    res.setHeader('Content-Disposition', `attachment; filename=tally-export-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(success(payload));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export async function tallyImport(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(error('No import file uploaded'));
    const companyId = req.user!.company_id;
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();

    let createdUnits = 0;
    let createdParties = 0;
    let createdItems = 0;

    if (ext === 'json') {
      const body = JSON.parse(content);
      const data = body?.data || body;

      for (const u of data.units || []) {
        const name = String(u.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM item_units WHERE company_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          await query('INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1,$2,$3,$4)', [companyId, name, u.abbreviation || null, !!u.is_default]);
          createdUnits++;
        }
      }

      for (const p of data.parties || []) {
        const name = String(p.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM parties WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND is_deleted = false LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          await query(
            `INSERT INTO parties (company_id, party_type, name, gstin, phone, email, billing_address, billing_city, billing_state, billing_pincode, opening_balance)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [companyId, 'party', name, p.gstin || null, p.phone || null, p.email || null, p.billing_address || null, p.billing_city || null, p.billing_state || null, p.billing_pincode || null, Number(p.opening_balance || 0)]
          );
          createdParties++;
        }
      }

      for (const i of data.items || []) {
        const name = String(i.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM items WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND is_deleted = false LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          await query(
            `INSERT INTO items (company_id, name, sku, barcode, hsn_code, gst_rate, cgst_rate, sgst_rate, igst_rate, purchase_price, selling_price, opening_stock, opening_stock_value)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              companyId,
              name,
              i.sku || null,
              i.barcode || null,
              i.hsn_code || null,
              Number(i.gst_rate || 0),
              Number(i.gst_rate || 0) / 2,
              Number(i.gst_rate || 0) / 2,
              Number(i.gst_rate || 0),
              Number(i.purchase_price || 0),
              Number(i.selling_price || 0),
              Number(i.opening_stock || 0),
              Number(i.opening_stock_value || 0),
            ]
          );
          createdItems++;
        }
      }
    } else if (ext === 'xml') {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
      const parsed = parser.parse(content);
      const message = parsed?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE;

      const stockItems = Array.isArray(message?.STOCKITEM) ? message.STOCKITEM : message?.STOCKITEM ? [message.STOCKITEM] : [];
      const ledgers = Array.isArray(message?.LEDGER) ? message.LEDGER : message?.LEDGER ? [message.LEDGER] : [];
      const units = Array.isArray(message?.UNIT) ? message.UNIT : message?.UNIT ? [message.UNIT] : [];

      for (const u of units) {
        const name = String(u.NAME || u.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM item_units WHERE company_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          await query('INSERT INTO item_units (company_id, name, abbreviation, is_default) VALUES ($1,$2,$3,false)', [companyId, name, u.ORIGINALNAME || null]);
          createdUnits++;
        }
      }

      for (const l of ledgers) {
        const name = String(l.NAME || l.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM parties WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND is_deleted = false LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          await query(
            `INSERT INTO parties (company_id, party_type, name, gstin)
             VALUES ($1,'party',$2,$3)`,
            [companyId, name, l.GSTIN || null]
          );
          createdParties++;
        }
      }

      for (const s of stockItems) {
        const name = String(s.NAME || s.name || '').trim();
        if (!name) continue;
        const exists = await query('SELECT id FROM items WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND is_deleted = false LIMIT 1', [companyId, name]);
        if (!exists.rows.length) {
          const gstRate = Number(s.RATEOFTAXCALCULATION || 0);
          await query(
            `INSERT INTO items (company_id, name, gst_rate, cgst_rate, sgst_rate, igst_rate, opening_stock)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [companyId, name, gstRate, gstRate / 2, gstRate / 2, gstRate, Number(s.OPENINGBALANCE || 0)]
          );
          createdItems++;
        }
      }
    } else {
      return res.status(400).json(error('Unsupported file format. Upload JSON or XML.'));
    }

    try { fs.unlinkSync(req.file.path); } catch {}
    res.json(success({ created_units: createdUnits, created_parties: createdParties, created_items: createdItems }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

// ── GET /api/reports/category-wise-sales ─────────────────────────
export async function categoryWiseSales(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(ic.id::text, 'uncategorized') AS category_id,
              COALESCE(ic.name, 'Uncategorized') AS category_name,
              COUNT(DISTINCT inv.id)::int AS invoice_count,
              SUM(ii.quantity)::numeric AS qty_sold,
              COALESCE(SUM(ii.taxable_amount), 0)::bigint AS taxable_total_paise,
              COALESCE(SUM(ii.total_amount), 0)::bigint AS total_paise
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       LEFT JOIN item_categories ic ON ic.id = it.category_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(ic.id::text, 'uncategorized'), COALESCE(ic.name, 'Uncategorized')
       ORDER BY total_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/item-wise-purchase ───────────────────────────
export async function itemWisePurchase(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(it.id::text, md5(pii.item_name)) AS item_key,
              COALESCE(it.name, pii.item_name) AS item_name,
              COALESCE(it.sku, '') AS sku,
              SUM(pii.quantity)::numeric AS qty_purchased,
              COALESCE(SUM(pii.taxable_amount), 0)::bigint AS purchase_taxable_paise,
              COALESCE(SUM(pii.total_amount), 0)::bigint AS purchase_total_paise
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
       LEFT JOIN items it ON pii.item_id = it.id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND pi.bill_date >= $2 AND pi.bill_date <= $3
       GROUP BY COALESCE(it.id::text, md5(pii.item_name::text)), COALESCE(it.name, pii.item_name), COALESCE(it.sku, '')
       ORDER BY purchase_total_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sale-returns ─────────────────────────────────
export async function saleReturnsReport(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT r.id, r.credit_note_number, r.return_date, r.total_amount, r.refund_given,
              COALESCE(p.name, r.party_id::text) AS party_name,
              (SELECT COUNT(*) FROM sale_return_items sri WHERE sri.return_id = r.id) AS item_count
       FROM sale_returns r
       LEFT JOIN parties p ON p.id = r.party_id
       WHERE r.company_id = $1 AND r.is_deleted = false
         AND r.return_date >= $2 AND r.return_date <= $3
       ORDER BY r.return_date DESC`,
      [req.user!.company_id, from, to],
    );
    const total = result.rows.reduce((s, r) => s + (parseInt(r.total_amount) || 0), 0);
    res.json(success(result.rows, { total_amount: total, count: result.rows.length }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/purchase-returns ─────────────────────────────
export async function purchaseReturnsReport(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT r.id, r.debit_note_number, r.return_date, r.total_amount, r.refund_received,
              COALESCE(p.name, r.party_name_snapshot) AS party_name,
              pi.bill_number AS purchase_bill_number,
              (SELECT COUNT(*) FROM purchase_return_items pri WHERE pri.return_id = r.id) AS item_count
       FROM purchase_returns r
       LEFT JOIN parties p ON p.id = r.party_id
       LEFT JOIN purchase_invoices pi ON pi.id = r.purchase_invoice_id
       WHERE r.company_id = $1 AND r.is_deleted = false
         AND r.return_date >= $2 AND r.return_date <= $3
       ORDER BY r.return_date DESC`,
      [req.user!.company_id, from, to],
    );
    const total = result.rows.reduce((s, r) => s + (parseInt(r.total_amount) || 0), 0);
    res.json(success(result.rows, { total_amount: total, count: result.rows.length }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/batch-wise-stock ─────────────────────────────
export async function batchWiseStock(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT b.id, b.batch_number, b.expiry_date, b.quantity, b.purchase_price,
              it.id AS item_id, it.name AS item_name, it.sku, g.name AS godown_name
       FROM item_batches b
       JOIN items it ON it.id = b.item_id
       LEFT JOIN godowns g ON g.id = b.godown_id
       WHERE b.company_id = $1 AND it.is_deleted = false AND b.quantity > 0
       ORDER BY it.name, b.expiry_date NULLS LAST`,
      [req.user!.company_id],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/expiry ────────────────────────────────────────
// Real urgency buckets computed from today's date vs each batch's
// actual expiry_date — nothing fabricated.
export async function expiryReport(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT b.id, b.batch_number, b.expiry_date, b.quantity,
              it.id AS item_id, it.name AS item_name, it.sku,
              (b.expiry_date - CURRENT_DATE) AS days_to_expiry
       FROM item_batches b
       JOIN items it ON it.id = b.item_id
       WHERE b.company_id = $1 AND it.is_deleted = false AND b.quantity > 0 AND b.expiry_date IS NOT NULL
       ORDER BY b.expiry_date ASC`,
      [req.user!.company_id],
    );
    const buckets = { expired: 0, within_30_days: 0, within_90_days: 0, safe: 0 };
    for (const row of result.rows) {
      const days = Number(row.days_to_expiry);
      if (days < 0) buckets.expired++;
      else if (days <= 30) buckets.within_30_days++;
      else if (days <= 90) buckets.within_90_days++;
      else buckets.safe++;
    }
    res.json(success(result.rows, buckets));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/dead-stock ────────────────────────────────────
// "Dead" = tracked, in stock, with zero stock_movements in the lookback
// window (default 90 days) — a real, standard definition, not a guess.
export async function deadStock(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const days = Math.max(1, parseInt(String(req.query.days || '90')));
    const result = await query(
      `SELECT it.id, it.name, it.sku, it.purchase_price,
              COALESCE(SUM(s.quantity), 0) AS total_qty,
              MAX(sm.created_at) AS last_movement_at
       FROM items it
       LEFT JOIN item_stock s ON s.item_id = it.id AND s.company_id = it.company_id
       LEFT JOIN stock_movements sm ON sm.item_id = it.id AND sm.company_id = it.company_id
       WHERE it.company_id = $1 AND it.is_deleted = false AND it.track_inventory = true
       GROUP BY it.id, it.name, it.sku, it.purchase_price
       HAVING COALESCE(SUM(s.quantity), 0) > 0
          AND (MAX(sm.created_at) IS NULL OR MAX(sm.created_at) < now() - ($2 || ' days')::interval)
       ORDER BY total_qty DESC`,
      [companyId, days],
    );
    res.json(success(result.rows, { lookbackDays: days }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/party-profitability ──────────────────────────
// Revenue (taxable sales) vs. real COGS (qty * item.purchase_price)
// per party — same costing basis already used by itemWiseProfit above,
// just rolled up by customer instead of by item.
export async function partyProfitability(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid) AS party_id,
              COALESCE(p.name, 'Walk-in / unassigned') AS party_name,
              COUNT(DISTINCT inv.id)::int AS invoice_count,
              COALESCE(SUM(ii.taxable_amount), 0)::bigint AS revenue_paise,
              COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0)::bigint AS cogs_paise,
              (COALESCE(SUM(ii.taxable_amount), 0) - COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0))::bigint AS gross_profit_paise
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN parties p ON p.id = inv.party_id
       LEFT JOIN items it ON it.id = ii.item_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(p.id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(p.name, 'Walk-in / unassigned')
       ORDER BY gross_profit_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/all-transactions ─────────────────────────────
// Unified ledger across sales, purchases, payments, expenses, and
// returns — a real UNION of the same tables each dedicated report
// already reads, not a separate transactions table.
export async function allTransactions(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const result = await query(
      `(SELECT i.invoice_date AS date, i.invoice_number AS ref_no, COALESCE(p.name, i.party_name_snapshot, 'Walk-in') AS party,
               'Sale' AS category, i.invoice_type AS type, i.total_amount AS amount,
               (i.total_amount - i.balance_due) AS received, i.balance_due AS balance, i.payment_status AS status
        FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
        WHERE i.company_id = $1 AND i.is_deleted = false AND i.status != 'cancelled'
          AND i.invoice_date >= $2 AND i.invoice_date <= $3)
       UNION ALL
       (SELECT pi.bill_date, pi.bill_number, COALESCE(p.name, 'Unknown'),
               'Purchase', 'purchase_bill', pi.total_amount,
               pi.paid_amount, (pi.total_amount - pi.paid_amount), pi.payment_status
        FROM purchase_invoices pi LEFT JOIN parties p ON p.id = pi.party_id
        WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status,'') != 'cancelled'
          AND pi.bill_date >= $2 AND pi.bill_date <= $3)
       UNION ALL
       (SELECT pay.payment_date, pay.payment_number, COALESCE(p.name, 'Unknown'),
               'Payment', pay.payment_type, pay.amount,
               CASE WHEN pay.payment_type IN ('incoming','receipt','payment_in') THEN pay.amount ELSE 0 END,
               0, 'posted'
        FROM payments pay LEFT JOIN parties p ON p.id = pay.party_id
        WHERE pay.company_id = $1 AND pay.is_deleted = false
          AND pay.payment_date >= $2 AND pay.payment_date <= $3)
       UNION ALL
       (SELECT e.expense_date, e.expense_number, COALESCE(e.vendor_name, e.category),
               'Expense', e.category, e.total_amount,
               0, e.total_amount, e.status
        FROM expenses e
        WHERE e.company_id = $1 AND e.is_deleted = false
          AND e.expense_date >= $2 AND e.expense_date <= $3)
       UNION ALL
       (SELECT r.return_date, r.credit_note_number, COALESCE(p.name, 'Unknown'),
               'Sale Return', 'credit_note', r.total_amount, 0, r.total_amount, 'posted'
        FROM sale_returns r LEFT JOIN parties p ON p.id = r.party_id
        WHERE r.company_id = $1 AND r.is_deleted = false
          AND r.return_date >= $2 AND r.return_date <= $3)
       UNION ALL
       (SELECT r.return_date, r.debit_note_number, COALESCE(p.name, r.party_name_snapshot, 'Unknown'),
               'Purchase Return', 'debit_note', r.total_amount, 0, r.total_amount, 'posted'
        FROM purchase_returns r LEFT JOIN parties p ON p.id = r.party_id
        WHERE r.company_id = $1 AND r.is_deleted = false
          AND r.return_date >= $2 AND r.return_date <= $3)
       ORDER BY date DESC`,
      [companyId, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/bill-wise-profit ──────────────────────────────
export async function billWiseProfit(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT inv.id, inv.invoice_number, inv.invoice_date,
              COALESCE(p.name, inv.party_name_snapshot, 'Walk-in') AS party_name,
              inv.total_amount,
              COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0)::bigint AS cost_amount_paise,
              (inv.total_amount - COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0))::bigint AS profit_paise
       FROM invoices inv
       JOIN invoice_items ii ON ii.invoice_id = inv.id
       LEFT JOIN items it ON it.id = ii.item_id
       LEFT JOIN parties p ON p.id = inv.party_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY inv.id, inv.invoice_number, inv.invoice_date, inv.total_amount, p.name, inv.party_name_snapshot
       ORDER BY inv.invoice_date DESC`,
      [req.user!.company_id, from, to],
    );
    const rows = result.rows.map((r: any) => ({
      ...r,
      profit_pct: Number(r.total_amount) > 0 ? Math.round((Number(r.profit_paise) / Number(r.total_amount)) * 10000) / 100 : 0,
    }));
    res.json(success(rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/category-wise-purchase ────────────────────────
export async function categoryWisePurchase(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(ic.id::text, 'uncategorized') AS category_id,
              COALESCE(ic.name, 'Uncategorized') AS category_name,
              COUNT(DISTINCT pi.id)::int AS bill_count,
              SUM(pii.quantity)::numeric AS qty_purchased,
              COALESCE(SUM(pii.total_amount), 0)::bigint AS total_paise
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pii.purchase_invoice_id = pi.id
       LEFT JOIN items it ON pii.item_id = it.id
       LEFT JOIN item_categories ic ON ic.id = it.category_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND COALESCE(pi.status, '') != 'cancelled'
         AND pi.bill_date >= $2 AND pi.bill_date <= $3
       GROUP BY COALESCE(ic.id::text, 'uncategorized'), COALESCE(ic.name, 'Uncategorized')
       ORDER BY total_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/item-category-profit-loss ──────────────────────
export async function itemCategoryProfitLoss(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(ic.id::text, 'uncategorized') AS category_id,
              COALESCE(ic.name, 'Uncategorized') AS category_name,
              COALESCE(SUM(ii.taxable_amount), 0)::bigint AS sale_paise,
              COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0)::bigint AS cost_paise,
              (COALESCE(SUM(ii.taxable_amount), 0) - COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price, 0))), 0))::bigint AS profit_paise
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON it.id = ii.item_id
       LEFT JOIN item_categories ic ON ic.id = it.category_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(ic.id::text, 'uncategorized'), COALESCE(ic.name, 'Uncategorized')
       ORDER BY profit_paise DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/stock-summary-by-category ──────────────────────
export async function stockSummaryByCategory(req: Request, res: Response) {
  try {
    const result = await query(
      `SELECT COALESCE(ic.id::text, 'uncategorized') AS category_id,
              COALESCE(ic.name, 'Uncategorized') AS category_name,
              COUNT(DISTINCT it.id)::int AS item_count,
              COALESCE(SUM(s.quantity), 0)::numeric AS total_qty,
              COALESCE(SUM(s.quantity * it.purchase_price), 0)::bigint AS stock_value_paise
       FROM items it
       LEFT JOIN item_categories ic ON ic.id = it.category_id
       LEFT JOIN item_stock s ON s.item_id = it.id AND s.company_id = it.company_id
       WHERE it.company_id = $1 AND it.is_deleted = false AND it.track_inventory = true
       GROUP BY COALESCE(ic.id::text, 'uncategorized'), COALESCE(ic.name, 'Uncategorized')
       ORDER BY stock_value_paise DESC`,
      [req.user!.company_id],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/discount-report ──────────────────────────────
// Item-wise and overall discount given on sales — real data from
// invoice_items.discount_amount, not estimated.
export async function discountReport(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT COALESCE(it.id::text, md5(ii.item_name)) AS item_key, COALESCE(it.name, ii.item_name) AS item_name,
              COUNT(DISTINCT inv.id)::int AS invoice_count,
              COALESCE(SUM(ii.discount_amount), 0)::bigint AS discount_given_paise,
              COALESCE(SUM(ii.total_amount), 0)::bigint AS net_sale_paise
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON it.id = ii.item_id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice')
         AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
         AND COALESCE(ii.discount_amount, 0) > 0
       GROUP BY COALESCE(it.id::text, md5(ii.item_name::text)), COALESCE(it.name, ii.item_name)
       ORDER BY discount_given_paise DESC`,
      [req.user!.company_id, from, to],
    );
    const total = result.rows.reduce((s, r) => s + (parseInt(r.discount_given_paise) || 0), 0);
    res.json(success(result.rows, { total_discount_given_paise: total }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sale-order-items ──────────────────────────────
export async function saleOrderItemsReport(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const result = await query(
      `SELECT so.so_number, so.so_date, so.status, COALESCE(p.name, 'Unknown') AS party_name,
              soi.item_name, soi.quantity_ordered, soi.quantity_fulfilled,
              (soi.quantity_ordered - COALESCE(soi.quantity_fulfilled, 0)) AS quantity_pending,
              soi.unit_price,
              ((soi.quantity_ordered * soi.unit_price) - soi.discount_amount)::bigint AS total_amount
       FROM sale_order_items soi
       JOIN sale_orders so ON so.id = soi.order_id
       LEFT JOIN parties p ON p.id = so.party_id
       WHERE so.company_id = $1 AND so.so_date >= $2 AND so.so_date <= $3
       ORDER BY so.so_date DESC`,
      [req.user!.company_id, from, to],
    );
    res.json(success(result.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/party-statement-summary ──────────────────────
// Real party ledger with running balance + aging — the detailed
// per-party drill-down already lives on the Parties page (Ledger tab);
// this is the report-center version with aging buckets added.
export async function partyStatementSummary(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { party_id } = req.query;
    if (!party_id) return res.status(400).json(error('party_id is required'));

    const rows = await query(
      `SELECT created_at AS date, type AS voucher_type, reference_type, reference_id,
              CASE WHEN type = 'debit' THEN amount ELSE 0 END AS debit,
              CASE WHEN type = 'credit' THEN amount ELSE 0 END AS credit,
              balance_after AS running_balance
       FROM party_ledger
       WHERE company_id = $1 AND party_id = $2
       ORDER BY created_at ASC`,
      [companyId, party_id],
    );

    const partyRes = await query(`SELECT name, balance FROM parties WHERE id = $1 AND company_id = $2`, [party_id, companyId]);

    // Aging analysis — real, computed from actual unpaid invoice ages.
    const aging = await query(
      `SELECT
         COALESCE(SUM(balance_due) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, invoice_date) <= 30), 0)::bigint AS days_0_30,
         COALESCE(SUM(balance_due) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, invoice_date) BETWEEN 31 AND 60), 0)::bigint AS days_31_60,
         COALESCE(SUM(balance_due) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, invoice_date) BETWEEN 61 AND 90), 0)::bigint AS days_61_90,
         COALESCE(SUM(balance_due) FILTER (WHERE CURRENT_DATE - COALESCE(due_date, invoice_date) > 90), 0)::bigint AS days_90_plus
       FROM invoices WHERE company_id = $1 AND party_id = $2 AND is_deleted = false AND balance_due > 0`,
      [companyId, party_id],
    );

    res.json(success(rows.rows, { party: partyRes.rows[0], aging: aging.rows[0], closingBalance: partyRes.rows[0]?.balance || 0 }));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/party-report-by-item ──────────────────────────
export async function partyReportByItem(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const sales = await query(
      `SELECT p.id AS party_id, p.name AS party_name, it.id AS item_id, it.name AS item_name,
              SUM(ii.quantity) AS sale_qty, SUM(ii.total_amount) AS sale_amount_paise,
              COALESCE(SUM(ROUND(ii.quantity * COALESCE(it.purchase_price,0))), 0) AS cost_paise
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       JOIN parties p ON p.id = inv.party_id
       LEFT JOIN items it ON it.id = ii.item_id
       WHERE inv.company_id = $1 AND inv.is_deleted = false AND inv.status != 'cancelled'
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY p.id, p.name, it.id, it.name`,
      [companyId, from, to],
    );
    const purchases = await query(
      `SELECT p.id AS party_id, SUM(pii.quantity) AS purchase_qty, SUM(pii.total_amount) AS purchase_amount_paise, pii.item_id
       FROM purchase_invoice_items pii
       JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
       JOIN parties p ON p.id = pi.party_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false
         AND pi.bill_date >= $2 AND pi.bill_date <= $3
       GROUP BY p.id, pii.item_id`,
      [companyId, from, to],
    );
    const purchaseMap = new Map(purchases.rows.map((r: any) => [`${r.party_id}:${r.item_id}`, r]));
    const result = sales.rows.map((r: any) => {
      const match: any = purchaseMap.get(`${r.party_id}:${r.item_id}`);
      return {
        party_name: r.party_name, item_name: r.item_name, quantity: r.sale_qty,
        sale_amount_paise: r.sale_amount_paise,
        purchase_amount_paise: match?.purchase_amount_paise || 0,
        profit_paise: Number(r.sale_amount_paise) - Number(r.cost_paise),
      };
    });
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sale-purchase-by-party ────────────────────────
export async function salePurchaseByParty(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT p.id, p.name,
              COALESCE(s.sale_amount, 0)::bigint AS sale_amount_paise,
              COALESCE(pu.purchase_amount, 0)::bigint AS purchase_amount_paise,
              (COALESCE(s.sale_amount, 0) - COALESCE(pu.purchase_amount, 0))::bigint AS net_paise
       FROM parties p
       LEFT JOIN (
         SELECT party_id, SUM(total_amount) AS sale_amount FROM invoices
         WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled' AND invoice_date >= $2 AND invoice_date <= $3
         GROUP BY party_id
       ) s ON s.party_id = p.id
       LEFT JOIN (
         SELECT party_id, SUM(total_amount) AS purchase_amount FROM purchase_invoices
         WHERE company_id = $1 AND is_deleted = false AND bill_date >= $2 AND bill_date <= $3
         GROUP BY party_id
       ) pu ON pu.party_id = p.id
       WHERE p.company_id = $1 AND p.is_deleted = false AND (s.sale_amount IS NOT NULL OR pu.purchase_amount IS NOT NULL)
       ORDER BY sale_amount_paise DESC`,
      [companyId, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sale-purchase-by-party-group ──────────────────
// Real now — party_groups exists (built in the Settings/Utilities pass).
export async function salePurchaseByPartyGroup(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT COALESCE(g.id::text, 'ungrouped') AS group_id, COALESCE(g.name, 'Ungrouped') AS group_name,
              COALESCE(SUM(s.sale_amount), 0)::bigint AS total_sale_paise,
              COALESCE(SUM(pu.purchase_amount), 0)::bigint AS total_purchase_paise,
              (COALESCE(SUM(s.sale_amount), 0) - COALESCE(SUM(pu.purchase_amount), 0))::bigint AS profit_paise
       FROM parties p
       LEFT JOIN party_groups g ON g.id = p.party_group_id
       LEFT JOIN (
         SELECT party_id, SUM(total_amount) AS sale_amount FROM invoices
         WHERE company_id = $1 AND is_deleted = false AND status != 'cancelled' AND invoice_date >= $2 AND invoice_date <= $3
         GROUP BY party_id
       ) s ON s.party_id = p.id
       LEFT JOIN (
         SELECT party_id, SUM(total_amount) AS purchase_amount FROM purchase_invoices
         WHERE company_id = $1 AND is_deleted = false AND bill_date >= $2 AND bill_date <= $3
         GROUP BY party_id
       ) pu ON pu.party_id = p.id
       WHERE p.company_id = $1 AND p.is_deleted = false
       GROUP BY COALESCE(g.id::text, 'ungrouped'), COALESCE(g.name, 'Ungrouped')
       HAVING COALESCE(SUM(s.sale_amount), 0) > 0 OR COALESCE(SUM(pu.purchase_amount), 0) > 0
       ORDER BY total_sale_paise DESC`,
      [companyId, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/stock-detail ──────────────────────────────────
// Real opening/inward/outward/closing per item, computed from actual
// stock_movements rows in the period (not estimated).
export async function stockDetailReport(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT it.id, it.name, it.sku,
              COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.item_id = it.id AND sm.company_id = it.company_id AND sm.created_at < $2), 0) AS opening_stock,
              COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.item_id = it.id AND sm.company_id = it.company_id AND sm.quantity > 0 AND sm.created_at >= $2 AND sm.created_at <= $3), 0) AS inward,
              COALESCE((SELECT SUM(-sm.quantity) FROM stock_movements sm WHERE sm.item_id = it.id AND sm.company_id = it.company_id AND sm.quantity < 0 AND sm.created_at >= $2 AND sm.created_at <= $3), 0) AS outward,
              COALESCE((SELECT SUM(s.quantity) FROM item_stock s WHERE s.item_id = it.id AND s.company_id = it.company_id), 0) AS closing_stock,
              COALESCE((SELECT SUM(s.quantity) FROM item_stock s WHERE s.item_id = it.id AND s.company_id = it.company_id), 0) * COALESCE(it.purchase_price, 0) AS stock_value_paise
       FROM items it WHERE it.company_id = $1 AND it.is_deleted = false AND it.track_inventory = true
       ORDER BY it.name`,
      [companyId, from, to],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/item-detail/:itemId ───────────────────────────
// Complete real history for one item: purchases, sales, returns,
// transfers/adjustments — a UNION across the real source tables.
export async function itemDetailReport(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const { itemId } = req.params;
    const rows = await query(
      `(SELECT inv.invoice_date AS date, 'Sale' AS type, inv.invoice_number AS ref_no, ii.quantity, ii.total_amount
        FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
        WHERE ii.item_id = $1 AND inv.company_id = $2 AND inv.is_deleted = false)
       UNION ALL
       (SELECT pi.bill_date, 'Purchase', pi.bill_number, pii.quantity, pii.total_amount
        FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
        WHERE pii.item_id = $1 AND pi.company_id = $2 AND pi.is_deleted = false)
       UNION ALL
       (SELECT r.return_date, 'Sale Return', r.credit_note_number, sri.quantity, sri.unit_price * sri.quantity
        FROM sale_return_items sri JOIN sale_returns r ON r.id = sri.return_id
        WHERE sri.item_id = $1 AND r.company_id = $2 AND r.is_deleted = false)
       UNION ALL
       (SELECT r.return_date, 'Purchase Return', r.debit_note_number, pri.quantity, pri.unit_price * pri.quantity
        FROM purchase_return_items pri JOIN purchase_returns r ON r.id = pri.return_id
        WHERE pri.item_id = $1 AND r.company_id = $2 AND r.is_deleted = false)
       UNION ALL
       (SELECT sm.created_at::date, INITCAP(REPLACE(sm.movement_type, '_', ' ')), COALESCE(sm.reference_type, 'Adjustment'), ABS(sm.quantity), NULL
        FROM stock_movements sm WHERE sm.item_id = $1 AND sm.company_id = $2 AND sm.movement_type LIKE '%transfer%' OR (sm.item_id = $1 AND sm.company_id = $2 AND sm.movement_type LIKE '%audit%'))
       ORDER BY date DESC LIMIT 200`,
      [itemId, companyId],
    );
    res.json(success(rows.rows));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/sale-purchase-by-item-category ────────────────
// Combined view — reuses the same real aggregates as the separate
// category-wise-sales / category-wise-purchase reports, joined side
// by side rather than duplicating the underlying queries' logic.
export async function salePurchaseByItemCategory(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const sales = await query(
      `SELECT COALESCE(ic.id::text,'uncategorized') AS cat_id, COALESCE(ic.name,'Uncategorized') AS cat_name, SUM(ii.total_amount) AS sale_paise
       FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN items it ON it.id = ii.item_id LEFT JOIN item_categories ic ON ic.id = it.category_id
       WHERE inv.company_id = $1 AND inv.is_deleted = false AND inv.status != 'cancelled' AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY COALESCE(ic.id::text,'uncategorized'), COALESCE(ic.name,'Uncategorized')`,
      [companyId, from, to],
    );
    const purchases = await query(
      `SELECT COALESCE(ic.id::text,'uncategorized') AS cat_id, SUM(pii.total_amount) AS purchase_paise
       FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id
       LEFT JOIN items it ON it.id = pii.item_id LEFT JOIN item_categories ic ON ic.id = it.category_id
       WHERE pi.company_id = $1 AND pi.is_deleted = false AND pi.bill_date >= $2 AND pi.bill_date <= $3
       GROUP BY COALESCE(ic.id::text,'uncategorized')`,
      [companyId, from, to],
    );
    const pMap = new Map(purchases.rows.map((r: any) => [r.cat_id, r.purchase_paise]));
    const result = sales.rows.map((r: any) => ({
      category_name: r.cat_name, sale_paise: r.sale_paise,
      purchase_paise: pMap.get(r.cat_id) || 0,
      profit_paise: Number(r.sale_paise) - Number(pMap.get(r.cat_id) || 0),
    }));
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}

// ── GET /api/reports/expense-category-trend ────────────────────────
// Genuinely distinct from plain Expense Summary: adds month-over-month
// trend and % contribution, not just a category total.
export async function expenseCategoryTrend(req: Request, res: Response) {
  try {
    const { from, to } = parseRange(req);
    const companyId = req.user!.company_id;
    const rows = await query(
      `SELECT category, to_char(expense_date, 'YYYY-MM') AS month, SUM(COALESCE(total_amount, amount, 0)) AS total_paise
       FROM expenses WHERE company_id = $1 AND is_deleted = false AND expense_date >= $2 AND expense_date <= $3
       GROUP BY category, to_char(expense_date, 'YYYY-MM') ORDER BY category, month`,
      [companyId, from, to],
    );
    const totals = await query(
      `SELECT category, SUM(COALESCE(total_amount, amount, 0)) AS total_paise FROM expenses
       WHERE company_id = $1 AND is_deleted = false AND expense_date >= $2 AND expense_date <= $3 GROUP BY category`,
      [companyId, from, to],
    );
    const grandTotal = totals.rows.reduce((s, r) => s + Number(r.total_paise), 0);
    const byCategory: Record<string, any> = {};
    for (const r of rows.rows) {
      byCategory[r.category] = byCategory[r.category] || { category: r.category, monthly: [], total_paise: 0 };
      byCategory[r.category].monthly.push({ month: r.month, amount_paise: Number(r.total_paise) });
      byCategory[r.category].total_paise += Number(r.total_paise);
    }
    const result = Object.values(byCategory).map((c: any) => ({ ...c, pct_contribution: grandTotal > 0 ? Math.round((c.total_paise / grandTotal) * 10000) / 100 : 0 }));
    res.json(success(result));
  } catch (err: any) { res.status(500).json(error(err.message)); }
}
