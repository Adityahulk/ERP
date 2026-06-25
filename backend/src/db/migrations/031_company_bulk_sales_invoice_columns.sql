ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS bulk_sales_invoice_columns jsonb;
