ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS delivery_challan_show_pricing boolean NOT NULL DEFAULT false;
