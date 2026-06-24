-- ═══════════════════════════════════════════════════════════════
-- Migration: 056_backup_currency_reminders.sql
--
-- Note on backup history: this does NOT add a new "backup_history"
-- table. The real autoBackup worker (built earlier this session)
-- already writes a durable row to job_runs for every backup attempt,
-- including the result (file path, row counts, tables included).
-- Adding a parallel history table would create two sources of truth
-- for the same real event — the API layer queries job_runs instead.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE backup_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL UNIQUE REFERENCES companies(id),
  frequency         varchar(20) NOT NULL DEFAULT 'manual', -- manual | daily | weekly | monthly
  retention_count   integer NOT NULL DEFAULT 14,
  encrypt           boolean NOT NULL DEFAULT false,
  last_run_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER backup_schedules_updated_at BEFORE UPDATE ON backup_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per restore attempt — real recovery audit trail, separate
-- from job_runs since a restore reads a backup but isn't itself a
-- queued background job (it's interactive: preview, then confirm).
CREATE TABLE restore_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  source_job_run_id uuid, -- the job_runs.id of the backup that was restored
  status          varchar(20) NOT NULL DEFAULT 'previewed', -- previewed | applied | failed
  tables_restored jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows_affected   integer NOT NULL DEFAULT 0,
  conflicts_found integer NOT NULL DEFAULT 0,
  performed_by    uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_restore_history_company ON restore_history(company_id, created_at DESC);

-- ── Multi-Currency ────────────────────────────────────────────────
-- NOTE: company-level currency settings already exist as of migration
-- 033 (companies.enabled_currencies, companies.default_currency) —
-- not duplicated here. What's genuinely new is real exchange rate
-- *values* (033 only added currency_code columns, never rate storage).
CREATE TABLE exchange_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  currency_code   varchar(3) NOT NULL,
  rate_to_base    numeric(18,6) NOT NULL,
  rate_date       date NOT NULL DEFAULT CURRENT_DATE,
  source          varchar(20) NOT NULL DEFAULT 'manual', -- manual | api
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, currency_code, rate_date)
);
CREATE INDEX idx_exchange_rates_company ON exchange_rates(company_id, currency_code, rate_date DESC);

-- invoices.currency_code / purchase_invoices.currency_code already
-- exist (migration 033) — only the actual rate-applied-at-transaction-
-- time is new.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) DEFAULT 1.0;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS currency_code varchar(3) DEFAULT 'INR';
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) DEFAULT 1.0;

-- ── Service Reminders ──────────────────────────────────────────────
CREATE TABLE service_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  party_id        uuid REFERENCES parties(id),
  item_id         uuid REFERENCES items(id),
  reminder_type   varchar(30) NOT NULL, -- amc | warranty | renewal | service_visit | subscription | maintenance
  title           varchar(255) NOT NULL,
  notes           text,
  due_date        date NOT NULL,
  recurrence      varchar(20), -- none | monthly | quarterly | yearly
  channel         varchar(20) NOT NULL DEFAULT 'whatsapp', -- whatsapp | email | sms
  status          varchar(20) NOT NULL DEFAULT 'pending', -- pending | sent | completed | cancelled
  last_sent_at    timestamptz,
  created_by      uuid REFERENCES users(id),
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER service_reminders_updated_at BEFORE UPDATE ON service_reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_service_reminders_company_due ON service_reminders(company_id, due_date, status) WHERE is_deleted = false;
