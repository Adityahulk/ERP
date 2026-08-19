-- Proforma invoices reuse the quotation engine but remain independently
-- filterable and require customer confirmation before sales conversion.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS document_type varchar(20) NOT NULL DEFAULT 'quotation',
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS delivery_terms text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

UPDATE quotations
SET document_type = 'quotation'
WHERE document_type IS NULL OR document_type NOT IN ('quotation', 'proforma');

CREATE INDEX IF NOT EXISTS idx_quotations_company_document_type
  ON quotations(company_id, document_type, created_at DESC)
  WHERE is_deleted = false;
