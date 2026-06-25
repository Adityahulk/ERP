ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_bank_account_id uuid REFERENCES company_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cheque_number varchar(80);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS instrument_date date;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clearance_status varchar(20) DEFAULT 'cleared';

CREATE INDEX IF NOT EXISTS idx_payments_company_bank_account
  ON payments(company_id, company_bank_account_id, payment_date)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_payments_cheques
  ON payments(company_id, payment_mode, payment_date)
  WHERE is_deleted = false AND payment_mode = 'cheque';
