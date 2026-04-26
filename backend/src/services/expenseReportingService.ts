import { query } from '../config/db';

type ExpenseGstColumnState = {
  cgst_amount: boolean;
  sgst_amount: boolean;
  igst_amount: boolean;
  amount_includes_gst: boolean;
};

let expenseColumnsPromise: Promise<ExpenseGstColumnState> | null = null;

async function loadExpenseColumns(): Promise<ExpenseGstColumnState> {
  const res = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'expenses'`
  );

  const cols = new Set(res.rows.map((r: { column_name: string }) => r.column_name));
  return {
    cgst_amount: cols.has('cgst_amount'),
    sgst_amount: cols.has('sgst_amount'),
    igst_amount: cols.has('igst_amount'),
    amount_includes_gst: cols.has('amount_includes_gst'),
  };
}

export async function getExpenseGstColumnState(): Promise<ExpenseGstColumnState> {
  if (!expenseColumnsPromise) expenseColumnsPromise = loadExpenseColumns();
  return expenseColumnsPromise;
}

function stateCodeExpr(gstinExpr: string): string {
  return `CASE
    WHEN ${gstinExpr} ~ '^[0-9]{2}' THEN LEFT(${gstinExpr}, 2)
    ELSE NULL
  END`;
}

export async function getExpenseGstSql(alias = 'e', companyAlias = 'c') {
  const cols = await getExpenseGstColumnState();
  const gstAmount = `COALESCE(${alias}.gst_amount, 0)`;
  const buyerCode = `COALESCE(NULLIF(${companyAlias}.state_code, ''), ${stateCodeExpr(`UPPER(COALESCE(${companyAlias}.gstin, ''))`)})`;
  const supplierCode = `COALESCE(${stateCodeExpr(`UPPER(COALESCE(${alias}.vendor_gstin, ''))`)}, ${buyerCode})`;
  const isIntra = `${supplierCode} = ${buyerCode}`;

  const fallbackCgst = `CASE
    WHEN ${gstAmount} <= 0 THEN 0
    WHEN ${isIntra} THEN ROUND(${gstAmount}::numeric / 2)::bigint
    ELSE 0
  END`;
  const fallbackSgst = `CASE
    WHEN ${gstAmount} <= 0 THEN 0
    WHEN ${isIntra} THEN ${gstAmount} - ROUND(${gstAmount}::numeric / 2)::bigint
    ELSE 0
  END`;
  const fallbackIgst = `CASE
    WHEN ${gstAmount} <= 0 THEN 0
    WHEN ${isIntra} THEN 0
    ELSE ${gstAmount}
  END`;

  return {
    taxableExpr: `COALESCE(${alias}.amount, 0)`,
    cgstExpr: cols.cgst_amount ? `COALESCE(${alias}.cgst_amount, 0)` : fallbackCgst,
    sgstExpr: cols.sgst_amount ? `COALESCE(${alias}.sgst_amount, 0)` : fallbackSgst,
    igstExpr: cols.igst_amount ? `COALESCE(${alias}.igst_amount, 0)` : fallbackIgst,
    totalExpr: `COALESCE(${alias}.total_amount, COALESCE(${alias}.amount, 0) + ${gstAmount})`,
  };
}
