-- Unify party_type to a single label for all business relationships (UI no longer distinguishes customer/supplier/etc.)
UPDATE parties SET party_type = 'party' WHERE party_type IS DISTINCT FROM 'party';
