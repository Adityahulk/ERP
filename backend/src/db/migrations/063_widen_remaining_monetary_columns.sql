-- Final monetary-capacity guard. Currency values are stored as integer paise;
-- widen amount-like integer columns without changing their values or units.
-- The broader suffix audit covers schemas that introduced monetary totals after
-- migrations 059/060, including later company-specific modules.
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
        column_name IN (
          'amount', 'subtotal', 'total', 'balance', 'balance_after',
          'round_off', 'debit', 'credit', 'total_debit', 'total_credit',
          'price', 'price_inr', 'hra', 'allowances', 'deductions',
          'credit_limit', 'current_balance', 'principal', 'fee'
        )
        OR column_name LIKE '%\_amount' ESCAPE '\'
        OR column_name LIKE '%\_subtotal' ESCAPE '\'
        OR column_name LIKE '%\_total' ESCAPE '\'
        OR column_name LIKE '%\_price' ESCAPE '\'
        OR column_name LIKE '%\_cost' ESCAPE '\'
        OR column_name LIKE '%\_value' ESCAPE '\'
        OR column_name LIKE '%\_balance' ESCAPE '\'
        OR column_name LIKE '%\_salary' ESCAPE '\'
        OR column_name LIKE '%\_debit' ESCAPE '\'
        OR column_name LIKE '%\_credit' ESCAPE '\'
        OR column_name LIKE '%\_limit' ESCAPE '\'
        OR column_name LIKE '%\_charges' ESCAPE '\'
        OR column_name LIKE '%\_charge' ESCAPE '\'
        OR column_name LIKE '%\_principal' ESCAPE '\'
        OR column_name LIKE '%\_fee' ESCAPE '\'
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

-- Fail the migration rather than allowing a money-shaped 32-bit column to
-- survive unnoticed. Generated balance columns are excluded because they
-- derive their type from the widened source columns.
DO $$
DECLARE
  remaining_columns text;
BEGIN
  SELECT string_agg(format('%I.%I', table_name, column_name), ', ' ORDER BY table_name, column_name)
  INTO remaining_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type IN ('smallint', 'integer')
    AND is_generated = 'NEVER'
    AND (
      column_name IN (
        'amount', 'subtotal', 'total', 'balance', 'balance_after',
        'round_off', 'debit', 'credit', 'total_debit', 'total_credit',
        'price', 'price_inr', 'hra', 'allowances', 'deductions',
        'credit_limit', 'current_balance', 'principal', 'fee'
      )
      OR column_name LIKE '%\_amount' ESCAPE '\'
      OR column_name LIKE '%\_subtotal' ESCAPE '\'
      OR column_name LIKE '%\_total' ESCAPE '\'
      OR column_name LIKE '%\_price' ESCAPE '\'
      OR column_name LIKE '%\_cost' ESCAPE '\'
      OR column_name LIKE '%\_value' ESCAPE '\'
      OR column_name LIKE '%\_balance' ESCAPE '\'
      OR column_name LIKE '%\_salary' ESCAPE '\'
      OR column_name LIKE '%\_debit' ESCAPE '\'
      OR column_name LIKE '%\_credit' ESCAPE '\'
      OR column_name LIKE '%\_limit' ESCAPE '\'
      OR column_name LIKE '%\_charges' ESCAPE '\'
      OR column_name LIKE '%\_charge' ESCAPE '\'
      OR column_name LIKE '%\_principal' ESCAPE '\'
      OR column_name LIKE '%\_fee' ESCAPE '\'
    );

  IF remaining_columns IS NOT NULL THEN
    RAISE EXCEPTION '32-bit monetary columns remain after audit: %', remaining_columns;
  END IF;
END $$;
