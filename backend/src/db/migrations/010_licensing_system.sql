-- ═══════════════════════════════════════════════════════════════
-- BizFlow ERP — Licensing System
-- Migration: 010_licensing_system.sql
-- Adds: registrants, license_tiers, licenses tables
-- Registrants are external license buyers, separate from internal users.
-- One registrant → many licenses → one company each → N users (capped by tier).
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. REGISTRANTS
-- People who sign up on the public website to buy licenses.
-- They are NOT internal ERP users — kept in a separate table.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE registrants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  varchar(500) NOT NULL,
  email                 varchar(200) NOT NULL,
  phone                 varchar(20),
  password_hash         varchar(500) NOT NULL,
  is_verified           boolean DEFAULT false,
  is_active             boolean DEFAULT true,
  last_login_at         timestamptz,
  password_reset_token  varchar(200),
  password_reset_expires timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  is_deleted            boolean DEFAULT false
);

CREATE UNIQUE INDEX idx_registrants_email ON registrants(email) WHERE is_deleted = false;

CREATE TRIGGER registrants_updated_at
  BEFORE UPDATE ON registrants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 2. LICENSE TIERS
-- Defines Silver / Gold / Diamond plans.
-- max_users: how many ERP user seats this tier allows.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE license_tiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(100) NOT NULL,           -- 'silver', 'gold', 'diamond'
  display_name  varchar(200) NOT NULL,           -- 'Silver', 'Gold', 'Diamond'
  max_users     integer NOT NULL,                -- 4 / 5 / 7
  price_inr     integer NOT NULL,                -- price in rupees (display only)
  description   text,
  sort_order    integer DEFAULT 0,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TRIGGER license_tiers_updated_at
  BEFORE UPDATE ON license_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 3. LICENSE TIER FEATURES
-- What each tier includes / excludes.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE license_tier_features (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id       uuid NOT NULL REFERENCES license_tiers(id) ON DELETE CASCADE,
  feature_key   varchar(100) NOT NULL,    -- e.g. 'invoicing', 'gst_filing', 'hr'
  feature_label varchar(200) NOT NULL,    -- Human-readable label
  is_included   boolean DEFAULT true,
  sort_order    integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_tier_features_tier ON license_tier_features(tier_id);


-- ─────────────────────────────────────────────────────────────
-- 4. LICENSES
-- A license purchased by a registrant for a specific tier.
-- One registrant can have many licenses.
-- One license → one company (set when activated).
-- status: pending → active → expired | revoked
-- ─────────────────────────────────────────────────────────────
CREATE TABLE licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_id   uuid NOT NULL REFERENCES registrants(id),
  tier_id         uuid NOT NULL REFERENCES license_tiers(id),
  license_key     varchar(100) NOT NULL UNIQUE DEFAULT upper(replace(gen_random_uuid()::text, '-', '')),
  status          varchar(20) NOT NULL DEFAULT 'pending',  -- pending | active | expired | revoked
  company_id      uuid REFERENCES companies(id),           -- set when activated
  activated_at    timestamptz,
  expires_at      timestamptz,
  notes           text,                                    -- admin notes (e.g. payment reference)
  requested_at    timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  is_deleted      boolean DEFAULT false,

  CONSTRAINT licenses_status_check CHECK (status IN ('pending', 'active', 'expired', 'revoked'))
);

CREATE INDEX idx_licenses_registrant ON licenses(registrant_id, is_deleted);
CREATE INDEX idx_licenses_company ON licenses(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_licenses_status ON licenses(status) WHERE is_deleted = false;

CREATE TRIGGER licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────
-- 5. ALTER COMPANIES — add license_id FK
-- Tracks which license provisioned this company.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS license_id uuid REFERENCES licenses(id);

CREATE INDEX idx_companies_license ON companies(license_id) WHERE license_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- 6. ALTER USERS — add session_version for single-device enforcement
-- Incremented on every login; JWT carries this value.
-- If JWT session_version != DB value, old device is kicked out.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;


-- ─────────────────────────────────────────────────────────────
-- 7. SEED: License Tiers
-- ─────────────────────────────────────────────────────────────
INSERT INTO license_tiers (name, display_name, max_users, price_inr, description, sort_order) VALUES
  ('silver',  'Silver',  4, 4999,  'Perfect for small businesses. 4 user seats with core ERP features — invoicing, inventory, purchases, and parties.', 1),
  ('gold',    'Gold',    5, 8999,  'Grow confidently. 5 user seats with full ERP including reports, GST filing, and expense management.', 2),
  ('diamond', 'Diamond', 7, 14999, 'Enterprise-grade. 7 user seats with every module — HR, manufacturing, job work, OCR scanning, and priority support.', 3)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 8. SEED: License Tier Features
-- ─────────────────────────────────────────────────────────────

-- Silver features
WITH silver AS (SELECT id FROM license_tiers WHERE name = 'silver')
INSERT INTO license_tier_features (tier_id, feature_key, feature_label, is_included, sort_order)
SELECT silver.id, f.key, f.label, f.included, f.ord FROM silver,
(VALUES
  ('invoicing',        'GST Invoicing & Billing',       true,  1),
  ('inventory',        'Inventory Management',           true,  2),
  ('purchases',        'Purchase Orders & GRN',          true,  3),
  ('parties',          'Parties & Ledger',               true,  4),
  ('basic_reports',    'Basic Reports (Sales/Purchase)', true,  5),
  ('multi_user',       '4 User Seats',                   true,  6),
  ('gst_filing',       'GST Filing (GSTR-1/3B)',          false, 7),
  ('expenses',         'Expense Tracking',               false, 8),
  ('hr',               'HR & Attendance',                false, 9),
  ('manufacturing',    'Manufacturing & BOM',            false, 10),
  ('job_work',         'Job Work Challans',              false, 11),
  ('ocr',              'OCR Bill Scanning',              false, 12),
  ('wholesale',        'Wholesale Orders',               false, 13)
) AS f(key, label, included, ord)
ON CONFLICT DO NOTHING;

-- Gold features
WITH gold AS (SELECT id FROM license_tiers WHERE name = 'gold')
INSERT INTO license_tier_features (tier_id, feature_key, feature_label, is_included, sort_order)
SELECT gold.id, f.key, f.label, f.included, f.ord FROM gold,
(VALUES
  ('invoicing',        'GST Invoicing & Billing',       true,  1),
  ('inventory',        'Inventory Management',           true,  2),
  ('purchases',        'Purchase Orders & GRN',          true,  3),
  ('parties',          'Parties & Ledger',               true,  4),
  ('basic_reports',    'Basic Reports (Sales/Purchase)', true,  5),
  ('multi_user',       '5 User Seats',                   true,  6),
  ('gst_filing',       'GST Filing (GSTR-1/3B)',          true,  7),
  ('expenses',         'Expense Tracking',               true,  8),
  ('hr',               'HR & Attendance',                false, 9),
  ('manufacturing',    'Manufacturing & BOM',            false, 10),
  ('job_work',         'Job Work Challans',              false, 11),
  ('ocr',              'OCR Bill Scanning',              true,  12),
  ('wholesale',        'Wholesale Orders',               false, 13)
) AS f(key, label, included, ord)
ON CONFLICT DO NOTHING;

-- Diamond features
WITH diamond AS (SELECT id FROM license_tiers WHERE name = 'diamond')
INSERT INTO license_tier_features (tier_id, feature_key, feature_label, is_included, sort_order)
SELECT diamond.id, f.key, f.label, f.included, f.ord FROM diamond,
(VALUES
  ('invoicing',        'GST Invoicing & Billing',       true,  1),
  ('inventory',        'Inventory Management',           true,  2),
  ('purchases',        'Purchase Orders & GRN',          true,  3),
  ('parties',          'Parties & Ledger',               true,  4),
  ('basic_reports',    'Basic Reports (Sales/Purchase)', true,  5),
  ('multi_user',       '7 User Seats',                   true,  6),
  ('gst_filing',       'GST Filing (GSTR-1/3B)',          true,  7),
  ('expenses',         'Expense Tracking',               true,  8),
  ('hr',               'HR & Attendance',                true,  9),
  ('manufacturing',    'Manufacturing & BOM',            true,  10),
  ('job_work',         'Job Work Challans',              true,  11),
  ('ocr',              'OCR Bill Scanning',              true,  12),
  ('wholesale',        'Wholesale Orders',               true,  13)
) AS f(key, label, included, ord)
ON CONFLICT DO NOTHING;
