ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS tax_settings jsonb DEFAULT '{}'::jsonb;

ALTER TABLE items
  ALTER COLUMN gst_rate TYPE numeric(7,3) USING gst_rate::numeric;

ALTER TABLE expenses
  ALTER COLUMN gst_rate TYPE numeric(7,3) USING gst_rate::numeric;
