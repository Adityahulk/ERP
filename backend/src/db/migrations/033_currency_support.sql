ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS enabled_currencies jsonb NOT NULL DEFAULT '["INR"]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_currency varchar(3) NOT NULL DEFAULT 'INR';

UPDATE companies
SET default_currency = UPPER(COALESCE(NULLIF(currency, ''), default_currency, 'INR'))
WHERE default_currency IS NULL OR default_currency = 'INR';

UPDATE companies
SET enabled_currencies = CASE
  WHEN default_currency = 'USD' THEN '["INR","USD"]'::jsonb
  ELSE enabled_currencies
END;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS price_currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE delivery_challans
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE delivery_challan_items
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS currency_code varchar(3) NOT NULL DEFAULT 'INR';
