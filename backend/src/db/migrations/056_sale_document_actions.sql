ALTER TABLE sale_returns
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';

UPDATE sale_returns SET status = 'active' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_sale_returns_status
  ON sale_returns(company_id, status)
  WHERE is_deleted = false;
