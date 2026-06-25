ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_phone_snapshot varchar(30);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS party_email_snapshot varchar(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_description text;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_source varchar(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source_label varchar(200);

CREATE TABLE IF NOT EXISTS invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  attachment_type varchar(30) NOT NULL DEFAULT 'document',
  file_url text,
  original_name varchar(500),
  description text,
  mime_type varchar(160),
  file_size integer,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice
  ON invoice_attachments(company_id, invoice_id)
  WHERE is_deleted = false;
