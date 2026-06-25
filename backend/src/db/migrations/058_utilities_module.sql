-- ═══════════════════════════════════════════════════════════════
-- Migration: 058_utilities_module.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Close Financial Year — real lock enforcement, not just a flag ──
CREATE TABLE financial_year_locks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  year_start      date NOT NULL,
  year_end        date NOT NULL,
  locked_at       timestamptz NOT NULL DEFAULT now(),
  locked_by       uuid REFERENCES users(id),
  backup_job_run_id uuid, -- the job_runs.id of the pre-close backup
  UNIQUE (company_id, year_start)
);
CREATE INDEX idx_financial_year_locks_company ON financial_year_locks(company_id, year_end DESC);

-- ── Salesman / Field Sales Tracking ────────────────────────────────
-- Schema supports real GPS coordinates from day one, but nothing in
-- this codebase can capture live location without a mobile client —
-- that part is honestly out of scope here, not faked.
CREATE TABLE salesmen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  user_id         uuid REFERENCES users(id), -- linked login, if the salesman has app/portal access
  name            varchar(150) NOT NULL,
  phone           varchar(20),
  email           varchar(150),
  target_amount_paise bigint,
  is_active       boolean NOT NULL DEFAULT true,
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE salesman_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  salesman_id     uuid NOT NULL REFERENCES salesmen(id),
  party_id        uuid REFERENCES parties(id),
  visit_date      date NOT NULL DEFAULT CURRENT_DATE,
  purpose         varchar(30) DEFAULT 'visit', -- visit | lead | collection
  notes           text,
  latitude        numeric(10,6),
  longitude       numeric(10,6),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_salesman_visits_company ON salesman_visits(company_id, salesman_id, visit_date DESC);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS collected_by_salesman_id uuid REFERENCES salesmen(id);

-- ── Accountant Access — real invite tokens, not just createUser ────
CREATE TABLE accountant_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  email           varchar(150) NOT NULL,
  token           varchar(100) NOT NULL UNIQUE,
  permissions     jsonb NOT NULL DEFAULT '{"reports": true, "books": true}'::jsonb,
  status          varchar(20) NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
  invited_by      uuid REFERENCES users(id),
  accepted_by     uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at     timestamptz
);
CREATE INDEX idx_accountant_invites_company ON accountant_invites(company_id, status);
