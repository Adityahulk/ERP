-- ═══════════════════════════════════════════════════════════════
-- Migration: 052_tenant_integrations.sql
--
-- Multi-tenant third-party integrations framework.
--
-- Design: ONE provider-agnostic table per concern (connections, sync
-- logs, webhook events) rather than a bespoke table per provider.
-- Every provider — Google Business, Google Ads, Meta Ads, WhatsApp
-- Business, Razorpay, Stripe, OpenAI, Anthropic, Gemini — fits the
-- same shape: a per-company credential blob (OAuth tokens or an API
-- key, always encrypted at rest), a status, and a history of sync
-- attempts. This is what lets new providers be added later as
-- config, not as new tables/migrations.
--
-- IMPORTANT DISTINCTION this schema encodes:
--   - Platform-level OAuth app credentials (Microtechnique's own
--     registered Google/Meta developer app Client ID + Secret) live
--     in environment variables, NOT in this table — there is exactly
--     one such app per provider, shared by every tenant.
--   - This table stores PER-TENANT data only: the access/refresh
--     token (or API key) a specific company obtained by authorizing
--     that platform app against THEIR OWN Google/Meta/Razorpay/etc.
--     account. Microtechnique never creates or holds the underlying
--     third-party account — only the per-tenant authorization to it.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE tenant_integrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  provider              varchar(40) NOT NULL, -- 'google_business' | 'google_ads' | 'meta_ads' | 'whatsapp_business' | 'razorpay' | 'stripe' | 'openai' | 'anthropic' | 'gemini'
  auth_type             varchar(20) NOT NULL, -- 'oauth' | 'api_key'
  status                varchar(20) NOT NULL DEFAULT 'not_connected', -- not_connected | connected | error | expired | revoked
  -- Encrypted at rest via lib/credentialsCrypto.ts (AES-256-GCM). For
  -- OAuth this holds {access_token, refresh_token, expires_at}; for
  -- API-key providers it holds {api_key} (and {api_secret} where a
  -- provider needs both, e.g. Razorpay key_id + key_secret).
  encrypted_credentials text,
  -- Non-secret context returned by the provider once connected, e.g.
  -- the connected Google Business account name, the Meta ad account
  -- ID, the WhatsApp Business phone number ID. Safe to display in UI.
  account_label         varchar(255),
  scopes                text,
  external_account_id   varchar(255),
  connected_by          uuid REFERENCES users(id),
  connected_at          timestamptz,
  last_synced_at        timestamptz,
  last_sync_status      varchar(20), -- success | failed
  last_error            text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_deleted            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

CREATE TABLE integration_sync_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  integration_id  uuid REFERENCES tenant_integrations(id) ON DELETE CASCADE,
  provider        varchar(40) NOT NULL,
  sync_type       varchar(50) NOT NULL, -- e.g. 'reviews', 'analytics', 'campaigns', 'manual_test'
  status          varchar(20) NOT NULL DEFAULT 'running', -- running | success | failed
  records_synced  integer NOT NULL DEFAULT 0,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- Inbound webhook audit trail. company_id is nullable because some
-- providers (Stripe, Razorpay) require verifying the payload/signature
-- BEFORE we know which tenant it belongs to.
CREATE TABLE integration_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        varchar(40) NOT NULL,
  company_id      uuid REFERENCES companies(id),
  event_type      varchar(100),
  payload         jsonb NOT NULL,
  signature_valid boolean,
  processed       boolean NOT NULL DEFAULT false,
  processing_error text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- Short-lived OAuth state tokens (CSRF protection + carrying which
-- company/provider initiated the flow across the redirect to the
-- provider and back).
CREATE TABLE integration_oauth_states (
  state           varchar(128) PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies(id),
  provider        varchar(40) NOT NULL,
  user_id         uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE TRIGGER tenant_integrations_updated_at
  BEFORE UPDATE ON tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_tenant_integrations_company ON tenant_integrations(company_id, is_deleted);
CREATE INDEX idx_integration_sync_logs_company ON integration_sync_logs(company_id, provider, started_at DESC);
CREATE INDEX idx_integration_webhook_events_provider ON integration_webhook_events(provider, received_at DESC);
CREATE INDEX idx_integration_oauth_states_expires ON integration_oauth_states(expires_at);
