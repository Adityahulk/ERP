-- Monetary values in this application are stored as whole paise. Widen the
-- physical storage without changing units, so existing values remain exact and
-- application code does not silently multiply or divide historical amounts.

-- These generated columns depend on monetary source columns and must be
-- recreated after those source columns are widened.
ALTER TABLE IF EXISTS invoices DROP COLUMN IF EXISTS balance_due;
ALTER TABLE IF EXISTS wholesale_orders DROP COLUMN IF EXISTS balance_due;

DO $$
DECLARE
  column_record record;
BEGIN
  FOR column_record IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('smallint', 'integer')
      AND is_generated = 'NEVER'
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
          'hra', 'allowances', 'deductions'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE bigint USING %I::bigint',
      column_record.table_name,
      column_record.column_name,
      column_record.column_name
    );
  END LOOP;
END $$;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS balance_due bigint
  GENERATED ALWAYS AS (total_amount - paid_amount) STORED;

ALTER TABLE IF EXISTS wholesale_orders
  ADD COLUMN IF NOT EXISTS balance_due bigint
  GENERATED ALWAYS AS (total_amount - paid_amount) STORED;

COMMENT ON COLUMN invoices.total_amount IS 'Invoice total stored as integer paise in bigint storage';
COMMENT ON COLUMN items.purchase_price IS 'Purchase price stored as integer paise in bigint storage';
COMMENT ON COLUMN items.selling_price IS 'Selling price stored as integer paise in bigint storage';
