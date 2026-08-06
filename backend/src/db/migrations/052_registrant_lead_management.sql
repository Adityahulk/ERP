-- Lead-management metadata for public license registrations.

ALTER TABLE registrants
  ADD COLUMN IF NOT EXISTS lead_status varchar(30) NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS lead_source varchar(50) NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

ALTER TABLE registrants
  DROP CONSTRAINT IF EXISTS registrants_lead_status_check;

ALTER TABLE registrants
  ADD CONSTRAINT registrants_lead_status_check
  CHECK (lead_status IN ('new', 'contacted', 'qualified', 'customer', 'lost'));

UPDATE registrants r
SET lead_status = 'customer'
WHERE EXISTS (
  SELECT 1
  FROM licenses l
  WHERE l.registrant_id = r.id
    AND l.is_deleted = false
    AND l.status IN ('active', 'trial')
);

CREATE INDEX IF NOT EXISTS idx_registrants_lead_status
  ON registrants(lead_status, created_at DESC)
  WHERE is_deleted = false;
