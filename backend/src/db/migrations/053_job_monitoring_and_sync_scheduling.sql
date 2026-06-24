-- ═══════════════════════════════════════════════════════════════
-- Migration: 053_job_monitoring_and_sync_scheduling.sql
--
-- Backs the real BullMQ worker infrastructure (jobs/queues.ts,
-- jobs/registerWorkers.ts). BullMQ keeps its own job state in Redis,
-- but that's ephemeral (trimmed/expires) and not queryable with SQL
-- for an admin dashboard — this table is the durable audit trail.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE job_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name      varchar(60) NOT NULL,
  job_id          varchar(100), -- BullMQ's own job id, for cross-referencing
  company_id      uuid REFERENCES companies(id), -- null for platform-wide jobs
  status          varchar(20) NOT NULL DEFAULT 'running', -- running | success | failed | dead_letter
  attempt         integer NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  result          jsonb,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     integer
);

CREATE INDEX idx_job_runs_queue_started ON job_runs(queue_name, started_at DESC);
CREATE INDEX idx_job_runs_company ON job_runs(company_id, started_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX idx_job_runs_status ON job_runs(status, started_at DESC);

-- One row per live worker process per queue, updated on a heartbeat
-- interval. A worker is considered unhealthy if last_heartbeat_at is
-- older than a few missed intervals.
CREATE TABLE worker_heartbeats (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name          varchar(60) NOT NULL,
  worker_instance_id  varchar(100) NOT NULL,
  status              varchar(20) NOT NULL DEFAULT 'running', -- running | paused | stopped
  jobs_processed      integer NOT NULL DEFAULT 0,
  jobs_failed         integer NOT NULL DEFAULT 0,
  started_at          timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_name, worker_instance_id)
);

-- Per-tenant, per-integration sync scheduling — drives the BullMQ
-- repeatable-job registration for "Scheduled Sync".
ALTER TABLE tenant_integrations
  ADD COLUMN IF NOT EXISTS sync_frequency varchar(20) NOT NULL DEFAULT 'manual', -- manual | hourly | daily
  ADD COLUMN IF NOT EXISTS last_sync_mode varchar(20); -- incremental | full

-- ═══════════════════════════════════════════════════════════════
-- Minimal real Campaign model — needed so the WhatsApp/Email Campaign
-- workers have actual persisted data to process. Without this, those
-- two workers would have nothing real to act on and would be exactly
-- the "placeholder worker" pattern this phase is meant to eliminate.
-- Deliberately minimal: a campaign is a channel + message template +
-- a recipient list pulled from parties at send time, processed by the
-- worker in batches with per-recipient delivery tracking.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  channel         varchar(20) NOT NULL, -- 'whatsapp' | 'email'
  name            varchar(255) NOT NULL,
  subject         varchar(255), -- email only
  message         text NOT NULL,
  segment         varchar(30) NOT NULL DEFAULT 'all', -- all | customers | suppliers | with_dues
  status          varchar(20) NOT NULL DEFAULT 'draft', -- draft | queued | sending | completed | failed
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count      integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES users(id),
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  party_id     uuid REFERENCES parties(id),
  contact      varchar(255) NOT NULL, -- phone or email, snapshotted at send time
  status       varchar(20) NOT NULL DEFAULT 'pending', -- pending | sent | failed
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_campaigns_company ON campaigns(company_id, is_deleted, created_at DESC);
CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id, status);

