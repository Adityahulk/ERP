import { Request, Response } from 'express';
import { query } from '../config/db';
import { success, error } from '../lib/response';

// ── GET /api/dashboard ────────────────────────────────────────
export async function getDashboard(req: Request, res: Response) {
  try {
    const companyId = req.user!.company_id;
    const today = new Date().toISOString().split('T')[0];

    // Today's sales
    const todaySales = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
       FROM invoices WHERE company_id = $1 AND invoice_type = 'sale' AND invoice_date = $2 AND status != 'cancelled' AND is_deleted = false`,
      [companyId, today]
    );

    // This month's sales
    const monthSales = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
       FROM invoices WHERE company_id = $1 AND invoice_type = 'sale' 
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
       LEFT JOIN (SELECT item_id, SUM(quantity) as qty FROM item_stock GROUP BY item_id) s ON s.item_id = i.id
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
       LEFT JOIN invoices i ON i.invoice_date = d::date AND i.company_id = $1 AND i.invoice_type = 'sale' AND i.status != 'cancelled' AND i.is_deleted = false
       GROUP BY d::date ORDER BY d::date`,
      [companyId]
    );

    // Top selling items (this month)
    const topItems = await query(
      `SELECT it.name, it.sku, SUM(ii.quantity) as total_qty, SUM(ii.total_amount) as total_amount
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE inv.company_id = $1 AND inv.invoice_type = 'sale' AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY it.name, it.sku
       ORDER BY total_amount DESC LIMIT 5`,
      [companyId]
    );

    // Payments today
    const todayPayments = await query(
      `SELECT 
         COALESCE(SUM(amount) FILTER (WHERE payment_type = 'payment_in'), 0) as received,
         COALESCE(SUM(amount) FILTER (WHERE payment_type = 'payment_out'), 0) as paid
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
        expenses: parseInt(monthExpenses.rows[0].total),
        profit: parseInt(monthSales.rows[0].total) - parseInt(monthExpenses.rows[0].total),
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
    const { from_date, to_date } = req.query;
    const from = from_date || new Date(new Date().getFullYear(), 3, 1).toISOString().split('T')[0]; // Apr 1
    const to = to_date || new Date().toISOString().split('T')[0];

    // Revenue
    const revenue = await query(
      `SELECT COALESCE(SUM(subtotal), 0) as gross_revenue,
              COALESCE(SUM(total_cgst + total_sgst + total_igst), 0) as tax_collected,
              COALESCE(SUM(discount_amount), 0) as discounts
       FROM invoices WHERE company_id = $1 AND invoice_type = 'sale' AND status != 'cancelled' AND is_deleted = false
         AND invoice_date >= $2 AND invoice_date <= $3`,
      [companyId, from, to]
    );

    // COGS
    const cogs = await query(
      `SELECT COALESCE(SUM(ii.quantity * it.purchase_price), 0) as total
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE inv.company_id = $1 AND inv.invoice_type = 'sale' AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3`,
      [companyId, from, to]
    );

    // Expenses
    const expenses = await query(
      `SELECT category, COALESCE(SUM(amount), 0) as total
       FROM expenses WHERE company_id = $1 AND is_deleted = false
         AND expense_date >= $2 AND expense_date <= $3
       GROUP BY category ORDER BY total DESC`,
      [companyId, from, to]
    );

    const totalExpenses = expenses.rows.reduce((s: number, r: any) => s + parseInt(r.total), 0);
    const grossRevenue = parseInt(revenue.rows[0].gross_revenue);
    const grossProfit = grossRevenue - parseInt(cogs.rows[0].total);
    const netProfit = grossProfit - totalExpenses;

    res.json(success({
      period: { from, to },
      revenue: {
        gross: grossRevenue,
        discounts: parseInt(revenue.rows[0].discounts),
        tax_collected: parseInt(revenue.rows[0].tax_collected),
      },
      cost_of_goods: parseInt(cogs.rows[0].total),
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
    const { from_date, to_date } = req.query;
    const from = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to = to_date || new Date().toISOString().split('T')[0];

    // Outward tax (sales)
    const outward = await query(
      `SELECT gst_rate, COUNT(*) as invoice_count,
              COALESCE(SUM(taxable_amount), 0) as taxable_value,
              COALESCE(SUM(cgst_amount), 0) as cgst,
              COALESCE(SUM(sgst_amount), 0) as sgst,
              COALESCE(SUM(igst_amount), 0) as igst,
              COALESCE(SUM(cess_amount), 0) as cess
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE inv.company_id = $1 AND inv.invoice_type = 'sale' AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY gst_rate ORDER BY gst_rate`,
      [companyId, from, to]
    );

    // Inward tax (purchases + expenses)
    const inward = await query(
      `SELECT gst_rate, COUNT(*) as invoice_count,
              COALESCE(SUM(taxable_amount), 0) as taxable_value,
              COALESCE(SUM(cgst_amount), 0) as cgst,
              COALESCE(SUM(sgst_amount), 0) as sgst,
              COALESCE(SUM(igst_amount), 0) as igst,
              COALESCE(SUM(cess_amount), 0) as cess
       FROM invoice_items ii
       JOIN invoices inv ON ii.invoice_id = inv.id
       WHERE inv.company_id = $1 AND inv.invoice_type = 'purchase' AND inv.status != 'cancelled' AND inv.is_deleted = false
         AND inv.invoice_date >= $2 AND inv.invoice_date <= $3
       GROUP BY gst_rate ORDER BY gst_rate`,
      [companyId, from, to]
    );

    const totalOutwardCgst = outward.rows.reduce((s: number, r: any) => s + parseInt(r.cgst), 0);
    const totalOutwardSgst = outward.rows.reduce((s: number, r: any) => s + parseInt(r.sgst), 0);
    const totalOutwardIgst = outward.rows.reduce((s: number, r: any) => s + parseInt(r.igst), 0);
    const totalInwardCgst = inward.rows.reduce((s: number, r: any) => s + parseInt(r.cgst), 0);
    const totalInwardSgst = inward.rows.reduce((s: number, r: any) => s + parseInt(r.sgst), 0);
    const totalInwardIgst = inward.rows.reduce((s: number, r: any) => s + parseInt(r.igst), 0);

    res.json(success({
      period: { from, to },
      outward_supplies: outward.rows,
      inward_supplies: inward.rows,
      summary: {
        cgst_payable: totalOutwardCgst - totalInwardCgst,
        sgst_payable: totalOutwardSgst - totalInwardSgst,
        igst_payable: totalOutwardIgst - totalInwardIgst,
        total_payable: (totalOutwardCgst - totalInwardCgst) + (totalOutwardSgst - totalInwardSgst) + (totalOutwardIgst - totalInwardIgst),
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
