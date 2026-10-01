CREATE INDEX IF NOT EXISTS idx_sale_returns_invoice
  ON sale_returns(company_id, invoice_id)
  WHERE invoice_id IS NOT NULL AND is_deleted = false;
