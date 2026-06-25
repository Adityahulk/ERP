ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS eway_bill_details jsonb NOT NULL DEFAULT '{}'::jsonb;

