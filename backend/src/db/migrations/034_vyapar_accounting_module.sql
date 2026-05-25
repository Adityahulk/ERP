-- Vyapar-style accounting module hardening.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_category varchar(80);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS normal_balance varchar(10);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance_type varchar(10);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency_code varchar(3) DEFAULT 'INR';

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS voucher_type varchar(40);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS voucher_number varchar(100);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS attachment_url varchar(500);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id);

ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS cost_center varchar(120);
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS reference_number varchar(120);
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS instrument_details jsonb;

UPDATE accounts
SET normal_balance = CASE
  WHEN LOWER(account_type) IN ('asset', 'expense') THEN 'debit'
  ELSE 'credit'
END
WHERE normal_balance IS NULL;

UPDATE accounts
SET opening_balance_type = normal_balance
WHERE opening_balance_type IS NULL;

UPDATE accounts
SET currency_code = 'INR'
WHERE currency_code IS NULL OR currency_code = '';

UPDATE accounts
SET is_locked = true,
    is_default = true
WHERE is_system = true;

CREATE INDEX IF NOT EXISTS idx_accounts_company_parent
  ON accounts(company_id, parent_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reference
  ON journal_entries(company_id, reference_type, reference_id)
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_reference_posted
  ON journal_entries(company_id, reference_type, reference_id)
  WHERE is_deleted = false
    AND reference_type IS NOT NULL
    AND reference_id IS NOT NULL
    AND COALESCE(status, 'posted') <> 'reversed';
