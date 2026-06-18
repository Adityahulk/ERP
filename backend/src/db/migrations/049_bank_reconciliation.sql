CREATE TABLE IF NOT EXISTS bank_reconciliation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_bank_account_id uuid NOT NULL REFERENCES company_bank_accounts(id) ON DELETE CASCADE,
  statement_from date NOT NULL,
  statement_to date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  book_balance_paise integer NOT NULL DEFAULT 0,
  statement_balance_paise integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES bank_reconciliation_sessions(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  description text,
  debit_paise integer NOT NULL DEFAULT 0,
  credit_paise integer NOT NULL DEFAULT 0,
  reference varchar(200),
  external_id varchar(200),
  match_status varchar(20) NOT NULL DEFAULT 'unmatched',
  matched_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_sessions_company
  ON bank_reconciliation_sessions(company_id, is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_session
  ON bank_statement_lines(session_id, is_deleted, match_status);

CREATE TRIGGER bank_reconciliation_sessions_updated_at
  BEFORE UPDATE ON bank_reconciliation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
