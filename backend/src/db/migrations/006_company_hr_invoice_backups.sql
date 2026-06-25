-- Company profile enrichment, HR self-service, document backup snapshots, and invoice presentation choices.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_category varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_legal_name varchar(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_trade_name varchar(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_status varchar(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_taxpayer_type varchar(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_address text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_last_fetched_at timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin_lookup_payload jsonb;

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  account_label   varchar(100),
  bank_name       varchar(200) NOT NULL,
  account_number  varchar(50) NOT NULL,
  ifsc            varchar(20),
  branch          varchar(200),
  upi_id          varchar(100),
  is_primary      boolean DEFAULT false,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  is_deleted      boolean DEFAULT false
);

CREATE TRIGGER company_bank_accounts_updated_at
  BEFORE UPDATE ON company_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_company_bank_accounts_company
  ON company_bank_accounts(company_id, is_deleted);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_bank_accounts_one_primary
  ON company_bank_accounts(company_id)
  WHERE is_primary = true AND is_deleted = false;

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS resignation_reason text;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS monthly_salary integer;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS basic_salary integer;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS hra integer;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS allowances integer DEFAULT 0;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS deductions integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS employee_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  document_type   varchar(100) NOT NULL,
  document_name   varchar(300) NOT NULL,
  file_url        varchar(500) NOT NULL,
  uploaded_by     uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now(),
  is_deleted      boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_user
  ON employee_documents(company_id, user_id, is_deleted);

CREATE TABLE IF NOT EXISTS employee_salary_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  salary_month    date NOT NULL,
  adjustment_type varchar(20) NOT NULL CHECK (adjustment_type IN ('bonus', 'deduction')),
  title           varchar(200) NOT NULL,
  amount          integer NOT NULL CHECK (amount >= 0),
  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now(),
  is_deleted      boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_employee_salary_adjustments_user_month
  ON employee_salary_adjustments(company_id, user_id, salary_month, is_deleted);

CREATE TABLE IF NOT EXISTS employee_salary_slips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  salary_month    date NOT NULL,
  gross_salary    integer NOT NULL DEFAULT 0,
  paid_leave_days numeric(6,2) DEFAULT 0,
  unpaid_leave_days numeric(6,2) DEFAULT 0,
  bonus_amount    integer DEFAULT 0,
  deduction_amount integer DEFAULT 0,
  net_salary      integer NOT NULL DEFAULT 0,
  snapshot        jsonb DEFAULT '{}',
  generated_by    uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now(),
  UNIQUE(company_id, user_id, salary_month)
);

CREATE TABLE IF NOT EXISTS owner_backup_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  entity_type     varchar(50) NOT NULL,
  entity_id       uuid,
  action          varchar(50) NOT NULL,
  snapshot        jsonb NOT NULL,
  created_by      uuid,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_backup_snapshots_company
  ON owner_backup_snapshots(company_id, entity_type, created_at);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_gst_invoice boolean DEFAULT true;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS is_gst_quote boolean DEFAULT true;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS is_gst_invoice boolean DEFAULT true;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS pdf_template varchar(30);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS document_theme varchar(30) DEFAULT 'classic';
