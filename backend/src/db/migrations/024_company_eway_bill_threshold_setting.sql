ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS eway_bill_only_above_50k boolean NOT NULL DEFAULT false;
