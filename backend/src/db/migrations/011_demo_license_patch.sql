-- ═══════════════════════════════════════════════════════════════
-- BizFlow ERP — Demo License Patch
-- Migration: 011_demo_license_patch.sql
-- Adds a demo registrant + active Diamond license to the seeded
-- demo company so the full license flow is visible on first login.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_registrant_id   uuid;
  v_tier_id         uuid;
  v_license_id      uuid;
  v_company_id      uuid;
  v_existing_lic    uuid;
BEGIN

  -- ── 1. Find the Diamond tier ────────────────────────────────
  SELECT id INTO v_tier_id FROM license_tiers WHERE name = 'diamond' LIMIT 1;
  IF v_tier_id IS NULL THEN
    RAISE NOTICE 'Diamond tier not found — skipping demo license patch';
    RETURN;
  END IF;

  -- ── 2. Find the demo company ────────────────────────────────
  SELECT id INTO v_company_id
  FROM companies
  WHERE email = 'admin@bizflowdemo.in' AND is_deleted = false
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Demo company not found — skipping demo license patch';
    RETURN;
  END IF;

  -- ── 3. Skip if already patched ──────────────────────────────
  SELECT license_id INTO v_existing_lic FROM companies WHERE id = v_company_id;
  IF v_existing_lic IS NOT NULL THEN
    RAISE NOTICE 'Demo company already has a license (%) — skipping', v_existing_lic;
    RETURN;
  END IF;

  -- ── 4. Create (or reuse) demo registrant ────────────────────
  SELECT id INTO v_registrant_id
  FROM registrants
  WHERE email = 'owner@demo.com' AND is_deleted = false
  LIMIT 1;

  IF v_registrant_id IS NULL THEN
    -- bcrypt hash of 'Demo@1234' at cost 12
    INSERT INTO registrants (name, email, phone, password_hash, is_verified, is_active)
    VALUES (
      'Demo Owner',
      'owner@demo.com',
      '9876543210',
      '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNv98YlbdHKBpAyCpMWHfD2hxO',
      true,
      true
    )
    RETURNING id INTO v_registrant_id;
  END IF;

  -- ── 5. Create an active Diamond license ─────────────────────
  INSERT INTO licenses (
    registrant_id, tier_id, status, company_id,
    activated_at, expires_at, notes
  ) VALUES (
    v_registrant_id,
    v_tier_id,
    'active',
    v_company_id,
    NOW(),
    NOW() + INTERVAL '10 years',
    'Demo license — pre-activated for demonstration purposes'
  )
  RETURNING id INTO v_license_id;

  -- ── 6. Link the license back to the company ─────────────────
  UPDATE companies
  SET license_id = v_license_id
  WHERE id = v_company_id;

  RAISE NOTICE 'Demo license created: % (Diamond, expires 10 years from now)', v_license_id;

END $$;
