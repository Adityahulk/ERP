-- ═══════════════════════════════════════════════════════════════
-- Migration: 061_mrp_and_label_completion.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE items ADD COLUMN IF NOT EXISTS mrp bigint;
