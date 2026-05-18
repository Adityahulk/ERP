CREATE TABLE IF NOT EXISTS loan_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_name varchar(200) NOT NULL,
  lender_name varchar(200),
  principal_amount integer NOT NULL DEFAULT 0,
  current_balance integer NOT NULL DEFAULT 0,
  interest_rate numeric(8,3) DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  loan_account_id uuid NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  transaction_type varchar(30) NOT NULL,
  amount integer NOT NULL,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_number varchar(100),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_accounts_company
  ON loan_accounts(company_id, is_deleted, is_active);

CREATE INDEX IF NOT EXISTS idx_loan_transactions_loan
  ON loan_transactions(company_id, loan_account_id, transaction_date DESC);
