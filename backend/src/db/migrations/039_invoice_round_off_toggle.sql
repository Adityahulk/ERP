ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS round_off_enabled boolean NOT NULL DEFAULT false;

UPDATE invoices
SET round_off_enabled = true
WHERE COALESCE(round_off, 0) <> 0;
