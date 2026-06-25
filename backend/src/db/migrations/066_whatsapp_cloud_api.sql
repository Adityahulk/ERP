-- ═══════════════════════════════════════════════════════════════
-- Migration: 066_whatsapp_cloud_api.sql
--
-- Meta WhatsApp Cloud API — the official, ToS-compliant alternative
-- to Twilio (direct relationship with Meta, no per-message markup).
-- whatsapp_mode now accepts 'cloud_api' alongside the existing
-- 'twilio' and 'qr_login' values (qr_login remains schema-only; see
-- 065's comments and the provider manager for why).
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_cloud_access_token_encrypted text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_cloud_phone_number_id varchar(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_cloud_verified_at timestamptz;
