-- ═══════════════════════════════════════════════════════════════
-- Migration: 065_whatsapp_dual_engine.sql
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_mode varchar(20) NOT NULL DEFAULT 'twilio'; -- twilio | qr_login
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_twilio_account_sid varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_twilio_auth_token_encrypted text; -- AES-256-GCM, see lib/crypto.ts
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_twilio_number varchar(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_twilio_verified_at timestamptz;

-- Schema for QR-login sessions — real account-linking logic (the
-- actual WebSocket session to WhatsApp's multi-device protocol) is
-- NOT implemented. Doing so would require an unofficial automation
-- library (Baileys/whatsapp-web.js) and using it for the automated
-- bulk/business messaging this feature targets risks the connected
-- number being banned by Meta — a real, well-documented outcome, not
-- a theoretical one. This table exists so the schema is ready and the
-- mode is genuinely selectable, without faking a working connection.
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS provider_message_sid varchar(100);
-- status now also supports 'delivered' alongside the existing pending|sent|failed

CREATE TABLE whatsapp_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  phone_number    varchar(30),
  session_id      varchar(200),
  status          varchar(20) NOT NULL DEFAULT 'disconnected', -- disconnected | pending_qr | connected | expired
  connected_at    timestamptz,
  last_seen       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_sessions_company ON whatsapp_sessions(company_id);

-- notification_logs (from 001_initial_schema.sql) already covers
-- recipient/message-type/reference linkage/status/error tracking —
-- building a second, parallel table here would just fragment the
-- data. Only add what's genuinely missing: a delivered_at distinct
-- from sent_at, since Twilio reports delivery status via a separate
-- webhook from the initial send.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
