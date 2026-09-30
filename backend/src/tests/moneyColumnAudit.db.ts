import assert from 'node:assert/strict';
import { pool } from '../config/db';

async function main(): Promise<void> {
  const remaining = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('smallint', 'integer')
       AND (
         column_name LIKE '%\_amount' ESCAPE '\'
         OR column_name LIKE '%\_price' ESCAPE '\'
         OR column_name LIKE '%\_cost' ESCAPE '\'
         OR column_name LIKE '%\_value' ESCAPE '\'
         OR column_name LIKE '%\_balance' ESCAPE '\'
         OR column_name LIKE '%\_salary' ESCAPE '\'
         OR column_name LIKE '%\_charges' ESCAPE '\'
         OR column_name IN (
           'amount', 'subtotal', 'balance', 'balance_after', 'round_off',
           'debit', 'credit', 'total_debit', 'total_credit', 'price', 'price_inr',
           'hra', 'allowances', 'deductions', 'credit_limit'
         )
       )
     ORDER BY table_name, column_name`,
  );

  assert.deepEqual(
    remaining.rows,
    [],
    `32-bit monetary columns remain: ${remaining.rows.map((row) => `${row.table_name}.${row.column_name}`).join(', ')}`,
  );

  const critical = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
         ('parties', 'credit_limit'),
         ('parties', 'opening_balance'),
         ('items', 'purchase_price'),
         ('items', 'selling_price'),
         ('items', 'opening_stock_value'),
         ('item_stock', 'avg_cost_price'),
         ('item_batches', 'purchase_price'),
         ('stock_movements', 'unit_cost'),
         ('invoices', 'total_amount'),
         ('invoice_items', 'unit_price'),
         ('purchase_invoices', 'total_amount'),
         ('purchase_invoice_items', 'unit_price'),
         ('quotations', 'total_amount'),
         ('sale_orders', 'total_amount'),
         ('sale_returns', 'total_amount'),
         ('journal_entry_lines', 'debit'),
         ('journal_entry_lines', 'credit'),
         ('loan_accounts', 'principal_amount'),
         ('payments', 'amount')
       )`,
  );
  // Proforma invoices share quotations.total_amount and are distinguished by
  // quotations.document_type, so that one column validates both document types.
  assert.equal(critical.rows.length, 19, 'One or more critical monetary columns are missing from the schema');
  for (const column of critical.rows) {
    assert.equal(column.data_type, 'bigint', `${column.table_name}.${column.column_name} must use bigint paise`);
  }

  await pool.end();
  console.log('Database monetary-column audit passed: no currency field remains smallint/integer.');
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
