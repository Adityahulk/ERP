import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';
import { getExpenseGstSql } from '../services/expenseReportingService';

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

    // Total receivable & payable
    const balances = await query(
      `SELECT 
         COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) as total_receivable,
         COALESCE(SUM(ABS(balance)) FILTER (WHERE balance < 0), 0) as total_payable
       FROM parties WHERE company_id = $1 AND is_deleted = false`,
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

    // Top selling items (this month)
    const topItems = await query(
      `SELECT it.name, it.sku, SUM(ii.quantity) as total_qty, SUM(ii.total_amount) as total_amount
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE inv.company_id = $1 AND (inv.invoice_type = 'sale' OR inv.invoice_type = 'tax_invoice') AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY it.name, it.sku
       ORDER BY total_amount DESC LIMIT 5`,
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

    res.json(success({
      today: {
        sales: todaySales.rows[0],
        payments: todayPayments.rows[0],
      },
      month: {
        sales: monthSales.rows[0],
        expenses: Number(monthExpenses.rows[0].total || 0),
        profit: Number(monthSales.rows[0].total || 0) - Number(monthExpenses.rows[0].total || 0),
      },
      balances: balances.rows[0],
      overdue: overdue.rows[0],
      low_stock_count: parseInt(lowStock.rows[0].count),
      recent_invoices: recentInvoices.rows,
      sales_trend: salesTrend.rows,
      top_items: topItems.rows,
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
              COALESCE(SUM(s.quantity), 0)::bigint AS total_qty,
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
      `SELECT i.id, i.name, i.sku, i.reorder_point::int,
              COALESCE(SUM(s.quantity), 0)::bigint AS total_qty,
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
      `SELECT a.id, a.code, a.name, a.account_type,
              COALESCE(a.opening_balance, 0)::bigint AS opening_balance_paise,
              COALESCE(SUM(
                CASE
                  WHEN je.id IS NULL THEN 0
                  WHEN a.account_type IN ('asset', 'expense') THEN jel.debit - jel.credit
                  ELSE jel.credit - jel.debit
                END
              ), 0)::bigint AS period_net_paise,
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
       GROUP BY a.id, a.code, a.name, a.account_type, a.opening_balance
       ORDER BY a.account_type, a.code NULLS LAST, a.name`,
      [companyId, from, to]
    );
    res.json(success({ period: { from, to }, rows: result.rows }));
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
