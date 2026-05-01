-- Idempotent: some deployments skipped 006 or ran against an older schema snapshot.
-- Keeps app INSERTs (pdf_template, document_theme, quotation is_gst_quote) compatible.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_gst_invoice boolean DEFAULT true;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS is_gst_quote boolean DEFAULT true;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS is_gst_invoice boolean DEFAULT true;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';
