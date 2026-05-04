-- ═══════════════════════════════════════════════════════════════
-- BizFlow ERP — Trial System
-- Migration: 012_trial_system.sql
-- Adds 'trial' as a valid license status so that self-serve
-- trial signups are tracked the same way as paid licenses.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Extend the status CHECK constraint to include 'trial' ───
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_status_check;
ALTER TABLE licenses ADD CONSTRAINT licenses_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'trial'));

-- ── 2. Index for quick trial lookups ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_licenses_trial
  ON licenses(status, expires_at)
  WHERE status = 'trial';

-- ── 3. Make users.company_id nullable for super_admin accounts ─
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;
