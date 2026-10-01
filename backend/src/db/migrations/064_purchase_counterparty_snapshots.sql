-- Allow a purchase bill to be recorded for a one-time supplier without
-- creating a Party master record. Existing Party-linked bills remain linked.
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS party_name_snapshot varchar(500),
  ADD COLUMN IF NOT EXISTS party_phone_snapshot varchar(50),
  ADD COLUMN IF NOT EXISTS party_gstin_snapshot varchar(50),
  ADD COLUMN IF NOT EXISTS party_state_code_snapshot varchar(20),
  ADD COLUMN IF NOT EXISTS billing_address_snapshot text;

UPDATE purchase_invoices pi
SET party_name_snapshot = p.name,
    party_phone_snapshot = p.phone,
    party_gstin_snapshot = p.gstin,
    party_state_code_snapshot = p.state_code,
    billing_address_snapshot = p.billing_address
FROM parties p
WHERE pi.party_id = p.id
  AND (pi.party_name_snapshot IS NULL OR pi.party_phone_snapshot IS NULL
       OR pi.party_gstin_snapshot IS NULL OR pi.party_state_code_snapshot IS NULL
       OR pi.billing_address_snapshot IS NULL);
