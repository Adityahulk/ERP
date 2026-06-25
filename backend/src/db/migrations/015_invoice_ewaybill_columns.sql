-- Store E-Way Bill details against invoices.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eway_bill_no varchar(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eway_bill_date timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eway_bill_valid_upto timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eway_bill_status varchar(20) DEFAULT 'not_generated';
