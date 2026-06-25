-- ═══════════════════════════════════════════════════════════════
-- Migration: 064_gst_registration_type.sql
--
-- Real eligibility basis for GSTR4-9C: which return types apply to a
-- company depends entirely on how it's registered under GST. Defaults
-- to 'regular' (the common case) so no existing company's filing
-- obligations change unless someone explicitly sets otherwise.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gst_registration_type varchar(30) NOT NULL DEFAULT 'regular';
-- regular | composition | casual_taxable | non_resident | input_service_distributor | tds_deductor | ecommerce_operator | unregistered
