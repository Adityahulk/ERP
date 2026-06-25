-- ═══════════════════════════════════════════════════════════════
-- Migration: 063_assign_code_starts_at_10001.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE companies ALTER COLUMN next_assign_code SET DEFAULT 10001;

-- Only bump companies that haven't issued any auto-generated code yet
-- (still sitting at the old default of 1) — never touch a company
-- that's already progressed past that, which would risk colliding
-- with or skipping codes already given to real items.
UPDATE companies SET next_assign_code = 10001 WHERE next_assign_code <= 1;
