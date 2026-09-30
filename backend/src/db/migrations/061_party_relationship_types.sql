-- Restore explicit customer/supplier roles while preserving the legacy
-- generic parties introduced by migration 013. A generic party could have
-- participated in either flow, so "both" is the lossless migration target.

UPDATE parties
SET party_type = 'both'
WHERE party_type IS NULL
   OR party_type NOT IN ('customer', 'supplier', 'both');

ALTER TABLE parties
  ALTER COLUMN party_type SET DEFAULT 'both';

ALTER TABLE parties
  DROP CONSTRAINT IF EXISTS parties_party_type_check;

ALTER TABLE parties
  ADD CONSTRAINT parties_party_type_check
  CHECK (party_type IN ('customer', 'supplier', 'both'));

COMMENT ON COLUMN parties.party_type IS 'Business relationship: customer, supplier, or both';
