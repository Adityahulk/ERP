import { Request, Response } from 'express';
import { query } from '../config/db';
import { error, success } from '../lib/response';

type ReportQuery = { sql: string; params?: (companyId: string, from: string, to: string, req: Request) => unknown[] };

function range(req: Request) {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(1);
  return {
    from: String(req.query.from_date || req.query.from || start.toISOString().slice(0, 10)),
    to: String(req.query.to_date || req.query.to || today),
  };
}

const dated = (sql: string): ReportQuery => ({ sql });
const undated = (sql: string): ReportQuery => ({ sql, params: (companyId) => [companyId] });

const reports: Record<string, ReportQuery> = {
  'all-transactions': dated(`
    SELECT txn_date, txn_type, reference_number, party_name, debit_paise, credit_paise, status FROM (
      SELECT i.invoice_date txn_date, 'Sale' txn_type, i.invoice_number reference_number,
        COALESCE(p.name, i.party_name_snapshot, 'Walk-in Customer') party_name,
        i.total_amount::bigint debit_paise, 0::bigint credit_paise, i.status
      FROM invoices i LEFT JOIN parties p ON p.id=i.party_id
      WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
      UNION ALL
      SELECT pi.bill_date, 'Purchase', pi.bill_number, COALESCE(p.name,'Unassigned supplier'),
        0::bigint, pi.total_amount::bigint, pi.status
      FROM purchase_invoices pi LEFT JOIN parties p ON p.id=pi.party_id
      WHERE pi.company_id=$1 AND pi.is_deleted=false AND COALESCE(pi.status,'')!='cancelled' AND pi.bill_date BETWEEN $2 AND $3
      UNION ALL
      SELECT pay.payment_date, CASE WHEN pay.payment_type IN ('payment_in','incoming') THEN 'Payment In' ELSE 'Payment Out' END,
        COALESCE(pay.payment_number,pay.reference_number,pay.id::text), COALESCE(p.name,'Cash / Bank'),
        CASE WHEN pay.payment_type IN ('payment_out','outgoing') THEN pay.amount ELSE 0 END::bigint,
        CASE WHEN pay.payment_type IN ('payment_in','incoming') THEN pay.amount ELSE 0 END::bigint, 'posted'
      FROM payments pay LEFT JOIN parties p ON p.id=pay.party_id
      WHERE pay.company_id=$1 AND pay.is_deleted=false AND pay.payment_date BETWEEN $2 AND $3
      UNION ALL
      SELECT e.expense_date, 'Expense', COALESCE(e.expense_number,e.reference_number,e.id::text), COALESCE(e.vendor_name,e.category),
        COALESCE(e.total_amount,e.amount,0)::bigint, 0::bigint, e.status
      FROM expenses e WHERE e.company_id=$1 AND e.is_deleted=false AND e.expense_date BETWEEN $2 AND $3
    ) t ORDER BY txn_date DESC, reference_number`),

  'bill-wise-profit': dated(`
    SELECT i.invoice_date, i.invoice_number, COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name,
      i.taxable_amount::bigint sales_paise,
      COALESCE(SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))),0)::bigint cost_paise,
      (i.taxable_amount-COALESCE(SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))),0))::bigint profit_paise,
      ROUND(CASE WHEN i.taxable_amount=0 THEN 0 ELSE
        (i.taxable_amount-COALESCE(SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))),0))*100.0/i.taxable_amount END,2) profit_percent
    FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN parties p ON p.id=i.party_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY i.id,p.name ORDER BY i.invoice_date DESC,i.invoice_number`),

  'sale-aging': dated(`
    SELECT COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name, i.invoice_number, i.invoice_date, i.due_date,
      i.balance_due::bigint balance_due_paise, GREATEST(CURRENT_DATE-COALESCE(i.due_date,i.invoice_date),0)::int age_days,
      CASE WHEN CURRENT_DATE<=COALESCE(i.due_date,i.invoice_date) THEN 'Current' WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date)<=30 THEN '1-30 days'
        WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date)<=60 THEN '31-60 days' WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date)<=90 THEN '61-90 days' ELSE '90+ days' END aging_bucket
    FROM invoices i LEFT JOIN parties p ON p.id=i.party_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled'
      AND i.balance_due>0 AND i.invoice_date BETWEEN $2 AND $3 ORDER BY age_days DESC,i.invoice_date`),

  'cash-flow': dated(`
    SELECT payment_date, payment_mode,
      SUM(CASE WHEN payment_type IN ('payment_in','incoming') THEN amount ELSE 0 END)::bigint inflow_paise,
      SUM(CASE WHEN payment_type IN ('payment_out','outgoing') THEN amount ELSE 0 END)::bigint outflow_paise,
      SUM(CASE WHEN payment_type IN ('payment_in','incoming') THEN amount ELSE -amount END)::bigint net_flow_paise
    FROM payments WHERE company_id=$1 AND is_deleted=false AND payment_date BETWEEN $2 AND $3
    GROUP BY payment_date,payment_mode ORDER BY payment_date`),

  'party-statement': {
    sql: `SELECT p.name party_name, l.created_at::date txn_date, l.type, l.amount::bigint amount_paise, l.balance_after::bigint balance_paise,
      l.reference_type, l.narration FROM party_ledger l JOIN parties p ON p.id=l.party_id
      WHERE l.company_id=$1 AND l.created_at::date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR l.party_id=$4)
      ORDER BY p.name,l.created_at,l.id`,
    params: (c,f,t,r) => [c,f,t,r.query.party_id || null],
  },

  'party-wise-profit-loss': dated(`
    SELECT COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name, COUNT(DISTINCT i.id)::int invoice_count,
      COALESCE(SUM(ii.taxable_amount),0)::bigint sales_paise,
      COALESCE(SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))),0)::bigint cost_paise,
      (COALESCE(SUM(ii.taxable_amount),0)-COALESCE(SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))),0))::bigint profit_paise
    FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN parties p ON p.id=i.party_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') ORDER BY profit_paise DESC`),

  'all-parties': undated(`
    SELECT name,party_type,phone,email,gstin,pan,COALESCE(balance,opening_balance,0)::bigint balance_paise,
      credit_limit::bigint credit_limit_paise,credit_days,is_active
    FROM parties WHERE company_id=$1 AND is_deleted=false ORDER BY name`),

  'party-report-by-item': dated(`
    SELECT COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name, COALESCE(it.name,ii.item_name) item_name,
      SUM(ii.quantity)::numeric quantity, COALESCE(SUM(ii.taxable_amount),0)::bigint taxable_paise, COALESCE(SUM(ii.total_amount),0)::bigint total_paise
    FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN parties p ON p.id=i.party_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer'),COALESCE(it.name,ii.item_name) ORDER BY party_name,item_name`),

  'sale-purchase-by-party': dated(`
    SELECT party_name,SUM(sale_paise)::bigint sale_paise,SUM(purchase_paise)::bigint purchase_paise FROM (
      SELECT COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name,SUM(i.total_amount) sale_paise,0 purchase_paise
      FROM invoices i LEFT JOIN parties p ON p.id=i.party_id WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3 GROUP BY 1
      UNION ALL SELECT COALESCE(p.name,'Unassigned supplier'),0,SUM(pi.total_amount)
      FROM purchase_invoices pi LEFT JOIN parties p ON p.id=pi.party_id WHERE pi.company_id=$1 AND pi.is_deleted=false AND COALESCE(pi.status,'')!='cancelled' AND pi.bill_date BETWEEN $2 AND $3 GROUP BY 1
    ) x GROUP BY party_name ORDER BY party_name`),

  'sale-summary-hsn': dated(`
    SELECT COALESCE(NULLIF(ii.hsn_code,''),'Unspecified') hsn_code,SUM(ii.quantity)::numeric quantity,
      SUM(ii.taxable_amount)::bigint taxable_paise,SUM(ii.cgst_amount)::bigint cgst_paise,SUM(ii.sgst_amount)::bigint sgst_paise,
      SUM(ii.igst_amount)::bigint igst_paise,SUM(ii.total_amount)::bigint total_paise
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
      AND COALESCE(it.item_type,'product')!='service' GROUP BY COALESCE(NULLIF(ii.hsn_code,''),'Unspecified') ORDER BY hsn_code`),

  'sac-report': dated(`
    SELECT COALESCE(NULLIF(ii.hsn_code,''),'Unspecified') sac_code,COALESCE(it.name,ii.item_name) service_name,SUM(ii.quantity)::numeric quantity,
      SUM(ii.taxable_amount)::bigint taxable_paise,SUM(ii.cgst_amount+ii.sgst_amount+ii.igst_amount)::bigint tax_paise,SUM(ii.total_amount)::bigint total_paise
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
      AND COALESCE(it.item_type,'product')='service' GROUP BY COALESCE(NULLIF(ii.hsn_code,''),'Unspecified'),COALESCE(it.name,ii.item_name) ORDER BY sac_code,service_name`),

  'item-report-by-party': dated(`
    SELECT COALESCE(it.name,ii.item_name) item_name,COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name,
      COUNT(DISTINCT i.id)::int invoice_count,SUM(ii.quantity)::numeric quantity,SUM(ii.total_amount)::bigint total_paise
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN parties p ON p.id=i.party_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY COALESCE(it.name,ii.item_name),COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') ORDER BY item_name,party_name`),

  'item-category-profit-loss': dated(`
    SELECT COALESCE(ic.name,'Uncategorised') category,SUM(ii.quantity)::numeric quantity,SUM(ii.taxable_amount)::bigint sales_paise,
      SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0)))::bigint cost_paise,
      (SUM(ii.taxable_amount)-SUM(ROUND(ii.quantity*COALESCE(it.purchase_price,0))))::bigint profit_paise
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN item_categories ic ON ic.id=it.category_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY COALESCE(ic.name,'Uncategorised') ORDER BY profit_paise DESC`),

  'stock-detail': dated(`
    SELECT sm.created_at::date txn_date,i.name item_name,COALESCE(g.name,'Unassigned') godown,sm.movement_type,sm.reference_type,
      sm.quantity::numeric quantity,sm.balance_after::numeric balance_after,sm.unit_cost::bigint unit_cost_paise
    FROM stock_movements sm JOIN items i ON i.id=sm.item_id LEFT JOIN godowns g ON g.id=sm.godown_id
    WHERE sm.company_id=$1 AND sm.created_at::date BETWEEN $2 AND $3 ORDER BY sm.created_at DESC`),

  'item-detail': undated(`
    SELECT i.name,i.sku,i.barcode,i.hsn_code,COALESCE(ic.name,'Uncategorised') category,COALESCE(u.name,i.item_type) unit,
      i.item_type,i.purchase_price::bigint purchase_price_paise,i.selling_price::bigint selling_price_paise,i.gst_rate,
      COALESCE(SUM(s.quantity),0)::numeric stock_quantity,i.reorder_point
    FROM items i LEFT JOIN item_categories ic ON ic.id=i.category_id LEFT JOIN item_units u ON u.id=i.unit_id LEFT JOIN item_stock s ON s.item_id=i.id AND s.company_id=i.company_id
    WHERE i.company_id=$1 AND i.is_deleted=false GROUP BY i.id,ic.name,u.name ORDER BY i.name`),

  'sale-purchase-by-item-category': dated(`
    SELECT category,SUM(sale_quantity)::numeric sale_quantity,SUM(sale_paise)::bigint sale_paise,SUM(purchase_quantity)::numeric purchase_quantity,SUM(purchase_paise)::bigint purchase_paise FROM (
      SELECT COALESCE(ic.name,'Uncategorised') category,SUM(ii.quantity) sale_quantity,SUM(ii.taxable_amount) sale_paise,0::numeric purchase_quantity,0::bigint purchase_paise
      FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id LEFT JOIN item_categories ic ON ic.id=it.category_id
      WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3 GROUP BY 1
      UNION ALL SELECT COALESCE(ic.name,'Uncategorised'),0,0,SUM(pii.quantity),SUM(COALESCE(pii.total_amount,0)-COALESCE(pii.cgst_amount,0)-COALESCE(pii.sgst_amount,0)-COALESCE(pii.igst_amount,0))
      FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id=pii.purchase_invoice_id LEFT JOIN items it ON it.id=pii.item_id LEFT JOIN item_categories ic ON ic.id=it.category_id
      WHERE pi.company_id=$1 AND pi.is_deleted=false AND COALESCE(pi.status,'')!='cancelled' AND pi.bill_date BETWEEN $2 AND $3 GROUP BY 1
    ) x GROUP BY category ORDER BY category`),

  'stock-summary-by-item-category': undated(`
    SELECT COALESCE(ic.name,'Uncategorised') category,COUNT(DISTINCT i.id)::int item_count,COALESCE(SUM(s.quantity),0)::numeric stock_quantity,
      COALESCE(SUM(ROUND(s.quantity*COALESCE(NULLIF(s.avg_cost_price,0),i.purchase_price,0))),0)::bigint stock_value_paise
    FROM items i LEFT JOIN item_categories ic ON ic.id=i.category_id LEFT JOIN item_stock s ON s.item_id=i.id AND s.company_id=i.company_id
    WHERE i.company_id=$1 AND i.is_deleted=false GROUP BY COALESCE(ic.name,'Uncategorised') ORDER BY category`),

  'item-wise-discount': dated(`
    SELECT COALESCE(it.name,ii.item_name) item_name,SUM(ii.quantity)::numeric quantity,SUM(ii.discount_amount)::bigint discount_paise,
      SUM(ii.taxable_amount)::bigint taxable_paise,SUM(ii.total_amount)::bigint total_paise
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN items it ON it.id=ii.item_id
    WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
    GROUP BY COALESCE(it.name,ii.item_name) HAVING SUM(ii.discount_amount)>0 ORDER BY discount_paise DESC`),

  'business-status': dated(`
    SELECT
      (SELECT COUNT(*) FROM invoices WHERE company_id=$1 AND invoice_type IN ('sale','tax_invoice') AND is_deleted=false AND status!='cancelled' AND invoice_date BETWEEN $2 AND $3)::int sale_count,
      (SELECT COALESCE(SUM(total_amount),0) FROM invoices WHERE company_id=$1 AND invoice_type IN ('sale','tax_invoice') AND is_deleted=false AND status!='cancelled' AND invoice_date BETWEEN $2 AND $3)::bigint sales_paise,
      (SELECT COALESCE(SUM(total_amount),0) FROM purchase_invoices WHERE company_id=$1 AND is_deleted=false AND COALESCE(status,'')!='cancelled' AND bill_date BETWEEN $2 AND $3)::bigint purchases_paise,
      (SELECT COALESCE(SUM(COALESCE(total_amount,amount)),0) FROM expenses WHERE company_id=$1 AND is_deleted=false AND expense_date BETWEEN $2 AND $3)::bigint expenses_paise,
      (SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE company_id=$1 AND invoice_type IN ('sale','tax_invoice') AND is_deleted=false AND status!='cancelled')::bigint receivable_paise,
      (SELECT COALESCE(SUM(quantity*COALESCE(NULLIF(avg_cost_price,0),0)),0) FROM item_stock WHERE company_id=$1)::bigint stock_value_paise`),

  'bank-statement': dated(`
    SELECT p.payment_date,COALESCE(ba.account_label,ba.bank_name,p.bank_account,p.payment_mode) account,p.payment_number,p.reference_number,
      COALESCE(pt.name,'Cash / Bank') party_name,
      CASE WHEN p.payment_type IN ('payment_in','incoming') THEN p.amount ELSE 0 END::bigint deposit_paise,
      CASE WHEN p.payment_type IN ('payment_out','outgoing') THEN p.amount ELSE 0 END::bigint withdrawal_paise
    FROM payments p LEFT JOIN company_bank_accounts ba ON ba.id=p.company_bank_account_id LEFT JOIN parties pt ON pt.id=p.party_id
    WHERE p.company_id=$1 AND p.is_deleted=false AND p.payment_date BETWEEN $2 AND $3 ORDER BY p.payment_date,p.created_at`),

  'taxes': dated(`
    SELECT txn_date,source,reference_number,taxable_paise,cgst_paise,sgst_paise,igst_paise,tcs_tds_paise FROM (
      SELECT invoice_date txn_date,'Sale' source,invoice_number reference_number,taxable_amount taxable_paise,cgst_amount cgst_paise,sgst_amount sgst_paise,igst_amount igst_paise,tcs_amount tcs_tds_paise
      FROM invoices WHERE company_id=$1 AND invoice_type IN ('sale','tax_invoice') AND is_deleted=false AND status!='cancelled' AND invoice_date BETWEEN $2 AND $3
      UNION ALL SELECT bill_date,'Purchase',bill_number,taxable_amount,cgst_amount,sgst_amount,igst_amount,tds_amount
      FROM purchase_invoices WHERE company_id=$1 AND is_deleted=false AND COALESCE(status,'')!='cancelled' AND bill_date BETWEEN $2 AND $3
    ) x ORDER BY txn_date,reference_number`),

  'gst-rate-report': dated(`
    SELECT direction,gst_rate,SUM(taxable_paise)::bigint taxable_paise,SUM(cgst_paise)::bigint cgst_paise,SUM(sgst_paise)::bigint sgst_paise,SUM(igst_paise)::bigint igst_paise FROM (
      SELECT 'Outward' direction,ii.gst_rate,ii.taxable_amount taxable_paise,ii.cgst_amount cgst_paise,ii.sgst_amount sgst_paise,ii.igst_amount igst_paise
      FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled' AND i.invoice_date BETWEEN $2 AND $3
      UNION ALL SELECT 'Inward',pii.gst_rate,COALESCE(pii.total_amount,0)-COALESCE(pii.cgst_amount,0)-COALESCE(pii.sgst_amount,0)-COALESCE(pii.igst_amount,0),pii.cgst_amount,pii.sgst_amount,pii.igst_amount
      FROM purchase_invoice_items pii JOIN purchase_invoices pi ON pi.id=pii.purchase_invoice_id WHERE pi.company_id=$1 AND pi.is_deleted=false AND COALESCE(pi.status,'')!='cancelled' AND pi.bill_date BETWEEN $2 AND $3
    ) x GROUP BY direction,gst_rate ORDER BY gst_rate,direction`),

  'form-27eq': dated(`
    SELECT i.invoice_date collection_date,COALESCE(p.pan,'Not provided') buyer_pan,COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') buyer_name,
      i.invoice_number,i.taxable_amount::bigint amount_paid_paise,i.tcs_amount::bigint tcs_paise
    FROM invoices i LEFT JOIN parties p ON p.id=i.party_id WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled'
      AND i.tcs_amount>0 AND i.invoice_date BETWEEN $2 AND $3 ORDER BY i.invoice_date,i.invoice_number`),

  'tcs-receivable': dated(`
    SELECT i.invoice_date,i.invoice_number,COALESCE(p.name,i.party_name_snapshot,'Walk-in Customer') party_name,
      i.tcs_amount::bigint tcs_paise,i.balance_due::bigint invoice_balance_paise,i.payment_status
    FROM invoices i LEFT JOIN parties p ON p.id=i.party_id WHERE i.company_id=$1 AND i.invoice_type IN ('sale','tax_invoice') AND i.is_deleted=false AND i.status!='cancelled'
      AND i.tcs_amount>0 AND i.invoice_date BETWEEN $2 AND $3 ORDER BY i.invoice_date`),

  'tds-payable': dated(`
    SELECT pi.bill_date,pi.bill_number,COALESCE(p.name,'Unassigned supplier') party_name,pi.taxable_amount::bigint taxable_paise,
      pi.tds_amount::bigint tds_paise,pi.payment_status
    FROM purchase_invoices pi LEFT JOIN parties p ON p.id=pi.party_id WHERE pi.company_id=$1 AND pi.is_deleted=false AND COALESCE(pi.status,'')!='cancelled'
      AND pi.tds_amount>0 AND pi.bill_date BETWEEN $2 AND $3 ORDER BY pi.bill_date`),

  'tds-receivable': dated(`
    SELECT je.entry_date,COALESCE(je.voucher_number,je.entry_number) reference_number,a.name account_name,
      COALESCE(p.name,'Unassigned') party_name,jel.debit::bigint debit_paise,jel.credit::bigint credit_paise,jel.description
    FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id JOIN accounts a ON a.id=jel.account_id LEFT JOIN parties p ON p.id=jel.party_id
    WHERE je.company_id=$1 AND je.is_deleted=false AND je.status='posted' AND a.name ILIKE '%TDS%Receivable%' AND je.entry_date BETWEEN $2 AND $3 ORDER BY je.entry_date`),

  'expense': dated(`
    SELECT expense_date,expense_number,category,description,vendor_name,bill_number,amount::bigint taxable_paise,
      COALESCE(tax_amount,gst_amount,0)::bigint tax_paise,COALESCE(total_amount,amount,0)::bigint total_paise,payment_mode,status
    FROM expenses WHERE company_id=$1 AND is_deleted=false AND expense_date BETWEEN $2 AND $3 ORDER BY expense_date DESC`),

  'expense-category': dated(`
    SELECT category,COUNT(*)::int entry_count,SUM(amount)::bigint taxable_paise,SUM(COALESCE(tax_amount,gst_amount,0))::bigint tax_paise,
      SUM(COALESCE(total_amount,amount,0))::bigint total_paise FROM expenses
    WHERE company_id=$1 AND is_deleted=false AND expense_date BETWEEN $2 AND $3 GROUP BY category ORDER BY total_paise DESC`),

  'expense-item': dated(`
    SELECT COALESCE(NULLIF(description,''),category) expense_item,category,COUNT(*)::int entry_count,
      SUM(COALESCE(total_amount,amount,0))::bigint total_paise FROM expenses
    WHERE company_id=$1 AND is_deleted=false AND expense_date BETWEEN $2 AND $3 GROUP BY COALESCE(NULLIF(description,''),category),category ORDER BY total_paise DESC`),

  'sale-purchase-orders': dated(`
    SELECT order_date,order_type,order_number,party_name,status,total_paise,ordered_quantity,fulfilled_quantity FROM (
      SELECT so.so_date order_date,'Sale Order' order_type,so.so_number order_number,COALESCE(p.name,so.party_name_snapshot,'Unassigned') party_name,so.status,so.total_amount::bigint total_paise,
        COALESCE(SUM(soi.quantity_ordered),0)::numeric ordered_quantity,COALESCE(SUM(soi.quantity_fulfilled),0)::numeric fulfilled_quantity
      FROM sale_orders so LEFT JOIN sale_order_items soi ON soi.order_id=so.id LEFT JOIN parties p ON p.id=so.party_id
      WHERE so.company_id=$1 AND so.is_deleted=false AND so.so_date BETWEEN $2 AND $3 GROUP BY so.id,p.name
      UNION ALL SELECT po.po_date,'Purchase Order',po.po_number,COALESCE(p.name,po.party_name_snapshot,'Unassigned'),po.status,po.total_amount,
        COALESCE(SUM(poi.quantity_ordered),0),COALESCE(SUM(poi.quantity_received),0)
      FROM purchase_orders po LEFT JOIN purchase_order_items poi ON poi.po_id=po.id LEFT JOIN parties p ON p.id=po.party_id
      WHERE po.company_id=$1 AND po.is_deleted=false AND po.po_date BETWEEN $2 AND $3 GROUP BY po.id,p.name
    ) x ORDER BY order_date DESC,order_number`),

  'sale-purchase-order-item': dated(`
    SELECT order_date,order_type,order_number,item_name,quantity_ordered,quantity_completed,unit,unit_price_paise,gst_rate FROM (
      SELECT so.so_date order_date,'Sale Order' order_type,so.so_number order_number,soi.item_name,soi.quantity_ordered,soi.quantity_fulfilled quantity_completed,soi.unit,soi.unit_price::bigint unit_price_paise,soi.gst_rate
      FROM sale_order_items soi JOIN sale_orders so ON so.id=soi.order_id WHERE so.company_id=$1 AND so.is_deleted=false AND so.so_date BETWEEN $2 AND $3
      UNION ALL SELECT po.po_date,'Purchase Order',po.po_number,poi.item_name,poi.quantity_ordered,poi.quantity_received,poi.unit,poi.unit_price,poi.gst_rate
      FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE po.company_id=$1 AND po.is_deleted=false AND po.po_date BETWEEN $2 AND $3
    ) x ORDER BY order_date DESC,order_number,item_name`),

  'other-income': dated(`
    SELECT je.entry_date,COALESCE(je.voucher_number,je.entry_number) reference_number,a.name income_account,
      COALESCE(p.name,'General') party_name,jel.credit::bigint income_paise,jel.description
    FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id JOIN accounts a ON a.id=jel.account_id LEFT JOIN parties p ON p.id=jel.party_id
    WHERE je.company_id=$1 AND je.is_deleted=false AND je.status='posted' AND a.account_type='income' AND je.entry_date BETWEEN $2 AND $3
      AND COALESCE(je.reference_type,'') NOT IN ('invoice','sale_invoice') ORDER BY je.entry_date DESC`),

  'other-income-category': dated(`
    SELECT COALESCE(parent.name,a.account_subtype,a.name) income_category,COUNT(*)::int entry_count,SUM(jel.credit-jel.debit)::bigint income_paise
    FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id JOIN accounts a ON a.id=jel.account_id LEFT JOIN accounts parent ON parent.id=a.parent_id
    WHERE je.company_id=$1 AND je.is_deleted=false AND je.status='posted' AND a.account_type='income' AND je.entry_date BETWEEN $2 AND $3
      AND COALESCE(je.reference_type,'') NOT IN ('invoice','sale_invoice') GROUP BY COALESCE(parent.name,a.account_subtype,a.name) ORDER BY income_paise DESC`),

  'other-income-item': dated(`
    SELECT a.name income_item,COALESCE(NULLIF(jel.description,''),je.description) description,COUNT(*)::int entry_count,
      SUM(jel.credit-jel.debit)::bigint income_paise FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id JOIN accounts a ON a.id=jel.account_id
    WHERE je.company_id=$1 AND je.is_deleted=false AND je.status='posted' AND a.account_type='income' AND je.entry_date BETWEEN $2 AND $3
      AND COALESCE(je.reference_type,'') NOT IN ('invoice','sale_invoice') GROUP BY a.name,COALESCE(NULLIF(jel.description,''),je.description) ORDER BY income_paise DESC`),

  'loan-statement': dated(`
    SELECT la.account_name,la.lender_name,lt.transaction_date,lt.transaction_type,lt.amount::bigint amount_paise,lt.reference_number,lt.notes,
      la.principal_amount::bigint principal_paise,la.current_balance::bigint current_balance_paise
    FROM loan_transactions lt JOIN loan_accounts la ON la.id=lt.loan_account_id
    WHERE lt.company_id=$1 AND la.is_deleted=false AND lt.transaction_date BETWEEN $2 AND $3 ORDER BY la.account_name,lt.transaction_date,lt.created_at`),
};

export async function catalogReport(req: Request, res: Response) {
  try {
    const definition = reports[req.params.reportKey];
    if (!definition) return res.status(404).json(error('Unknown report'));
    const { from, to } = range(req);
    if (from > to) return res.status(400).json(error('from_date must be on or before to_date'));
    const companyId = req.user!.company_id;
    const params = definition.params ? definition.params(companyId, from, to, req) : [companyId, from, to];
    const result = await query(definition.sql, params);
    res.json(success(result.rows, { period: { from, to }, report: req.params.reportKey }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
}

export const reportCatalogKeys = Object.freeze(Object.keys(reports));
export const reportCatalogDefinitions = reports;
