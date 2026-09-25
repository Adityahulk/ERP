-- Rich Proforma Invoice identity and presentation fields.
-- Existing quotations and Proforma Invoices remain valid; new snapshots are optional.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS document_tagline varchar(250),
  ADD COLUMN IF NOT EXISTS proforma_validity_days integer NOT NULL DEFAULT 14;

UPDATE companies
SET proforma_validity_days = 14
WHERE proforma_validity_days IS NULL OR proforma_validity_days < 1 OR proforma_validity_days > 365;

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS is_interstate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS party_address_override text,
  ADD COLUMN IF NOT EXISTS party_gstin_override varchar(20),
  ADD COLUMN IF NOT EXISTS party_state_override varchar(200),
  ADD COLUMN IF NOT EXISTS party_state_code_override varchar(5),
  ADD COLUMN IF NOT EXISTS salesperson_name_snapshot varchar(500),
  ADD COLUMN IF NOT EXISTS salesperson_phone_snapshot varchar(20),
  ADD COLUMN IF NOT EXISTS salesperson_email_snapshot varchar(200);

-- GST slabs can contain decimal rates such as 0.25% and 7.5%.
ALTER TABLE quotation_items
  ALTER COLUMN gst_rate TYPE numeric(7,3) USING gst_rate::numeric;

