-- ═══════════════════════════════════════════════════════════════
-- Migration: 057_party_groups_message_templates_settings.sql
--
-- Most of "Settings" already exists and is real: transaction_settings,
-- print_settings, tax_settings, transaction_prefixes, terms_and_conditions,
-- additional_fields_config, transportation_details_config,
-- additional_charges_config, financial_year_start, enabled_currencies/
-- default_currency, item_settings. This migration adds only what's
-- genuinely missing: party grouping, DB-configurable message templates
-- (today's templates are hardcoded in notificationService.ts — this is
-- what makes them actually editable per tenant), and a few real toggles.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE party_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        varchar(100) NOT NULL,
  party_type  varchar(20) NOT NULL DEFAULT 'both', -- customer | supplier | both
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE parties ADD COLUMN IF NOT EXISTS party_group_id uuid REFERENCES party_groups(id);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS credit_limit bigint;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS payment_reminder_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Generic custom-field DEFINITIONS for parties — same shape as the
-- existing per-item custom field defs already used elsewhere in
-- Settings, just for the 'party' scope which didn't exist yet.
CREATE TABLE party_custom_field_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  label       varchar(100) NOT NULL,
  field_type  varchar(20) NOT NULL DEFAULT 'text', -- text | number | date
  show_in_print boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Transaction Message Settings — real, DB-backed templates ───────
-- Replaces the hardcoded TEMPLATES map in notificationService.ts for
-- any tenant who customizes one; falls back to the hardcoded default
-- when no row exists, so nothing breaks for tenants who never touch it.
CREATE TABLE message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  channel         varchar(20) NOT NULL, -- whatsapp | sms | email
  template_type   varchar(40) NOT NULL, -- INVOICE_SHARE | PAYMENT_REMINDER | LOW_STOCK_ALERT | CAMPAIGN_BROADCAST | SALE_RETURN | PURCHASE_RETURN | PURCHASE_SHARE | PAYMENT_OUT_SHARE | SERVICE_REMINDER
  subject         varchar(255), -- email only
  content         text NOT NULL,
  send_copy_to_self boolean NOT NULL DEFAULT false,
  auto_send       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  updated_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, channel, template_type)
);
CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Inventory enforcement toggles (real, checked at write time) ────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stop_sale_on_negative_stock boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS block_new_items_in_transactions boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS block_new_parties_in_transactions boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS accounting_module_enabled boolean NOT NULL DEFAULT true;

-- Loyalty — minimal real points ledger, tied to real invoice totals.
CREATE TABLE loyalty_settings (
  company_id        uuid PRIMARY KEY REFERENCES companies(id),
  enabled           boolean NOT NULL DEFAULT false,
  points_per_rupee  numeric(6,3) NOT NULL DEFAULT 1, -- points earned per ₹100 spent
  redemption_value_paise integer NOT NULL DEFAULT 100, -- paise value of 1 point when redeemed
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  party_id    uuid NOT NULL REFERENCES parties(id),
  invoice_id  uuid REFERENCES invoices(id),
  points      integer NOT NULL, -- positive = earned, negative = redeemed
  reason      varchar(100),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_ledger_party ON loyalty_ledger(company_id, party_id, created_at DESC);
