ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sales_invoice_custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
