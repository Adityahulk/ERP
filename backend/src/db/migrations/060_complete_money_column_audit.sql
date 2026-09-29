-- Complete the monetary-capacity audit started in migration 059.
--
-- Microtechnique stores currency as whole paise, so bigint is the exact
-- equivalent of numeric currency storage for the existing API contract. It
-- preserves every historical value and safely stores amounts such as
-- Rs 90,00,00,00,000 (9,000,000,000,000 paise) without float rounding.

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
          'hra', 'allowances', 'deductions', 'credit_limit'
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

-- A migration should fail visibly if a known currency-shaped column was not
-- widened. This prevents another quiet 32-bit money regression.
DO $$
DECLARE
  remaining_columns text;
BEGIN
  SELECT string_agg(format('%I.%I', table_name, column_name), ', ' ORDER BY table_name, column_name)
  INTO remaining_columns
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
    );

  IF remaining_columns IS NOT NULL THEN
    RAISE EXCEPTION '32-bit monetary columns remain after audit: %', remaining_columns;
  END IF;
END $$;

COMMENT ON COLUMN parties.credit_limit IS 'Credit limit stored as integer paise in bigint storage';
