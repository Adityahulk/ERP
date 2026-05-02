-- Bank account chosen per invoice / purchase bill; snapshots keep PDF stable if master is edited later.
ALTER TABLE company_bank_accounts ALTER COLUMN account_number DROP NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_bank_account_id uuid REFERENCES company_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_label_snapshot varchar(200);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_name_snapshot varchar(200);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_account_number_snapshot varchar(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_ifsc_snapshot varchar(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_branch_snapshot varchar(200);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS upi_id_snapshot varchar(100);

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS company_bank_account_id uuid REFERENCES company_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_label_snapshot varchar(200);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_name_snapshot varchar(200);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_account_number_snapshot varchar(50);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_ifsc_snapshot varchar(20);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_branch_snapshot varchar(200);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS upi_id_snapshot varchar(100);
