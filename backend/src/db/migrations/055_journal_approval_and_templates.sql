-- ═══════════════════════════════════════════════════════════════
-- Migration: 055_journal_approval_and_templates.sql
--
-- The accounting engine here is already mature — journal_entries
-- already has voucher_number/type, attachment_url, remarks,
-- cancelled_at/by; journal_entry_lines already has cost_center,
-- reference_number, instrument_details (from migration 034). What's
-- genuinely missing: an approval workflow for MANUAL entries (system-
-- generated entries from sales/purchase/payments etc. continue to
-- post immediately, unchanged), a Branch dimension, and recurring
-- journal templates.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Branch dimension — reuses the existing godowns table (already used
-- as the location/branch concept elsewhere, e.g. attendance, leave
-- applications) rather than inventing a parallel "branches" table.
ALTER TABLE journal_entry_lines
  ADD COLUMN IF NOT EXISTS godown_id uuid REFERENCES godowns(id);

CREATE TABLE journal_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  name          varchar(200) NOT NULL,
  description   text,
  voucher_type  varchar(40) DEFAULT 'journal',
  -- Line shape: [{account_id, debit, credit, description, cost_center}]
  -- Amounts are templates only — re-entered/confirmed at apply time,
  -- never auto-posted silently.
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_recurring  boolean NOT NULL DEFAULT false,
  recurrence    varchar(20), -- monthly | quarterly | yearly
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER journal_templates_updated_at
  BEFORE UPDATE ON journal_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_journal_templates_company ON journal_templates(company_id, is_deleted, is_active);
