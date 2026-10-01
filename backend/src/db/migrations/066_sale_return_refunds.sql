-- Keep cash refunds linked to their credit note. A deleted/reversed payment no
-- longer occupies the one-active-refund slot, allowing a corrected refund.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS sale_return_id uuid REFERENCES sale_returns(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_active_sale_return_refund
  ON payments(company_id, sale_return_id)
  WHERE sale_return_id IS NOT NULL AND is_deleted = false;
