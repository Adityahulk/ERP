-- ═══════════════════════════════════════════════════════════════
-- Migration: 062_coupon_codes.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE coupon_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  code            varchar(40) NOT NULL,
  discount_type   varchar(20) NOT NULL DEFAULT 'percent', -- percent | flat
  discount_value  numeric(10,2) NOT NULL, -- percent (0-100) or flat rupees depending on discount_type
  min_purchase_paise bigint NOT NULL DEFAULT 0,
  max_discount_paise bigint, -- cap for percent-type coupons; null = uncapped
  usage_limit     integer, -- null = unlimited
  used_count      integer NOT NULL DEFAULT 0,
  valid_from      date NOT NULL DEFAULT CURRENT_DATE,
  valid_until     date,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE coupon_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       uuid NOT NULL REFERENCES coupon_codes(id),
  invoice_id      uuid REFERENCES invoices(id),
  company_id      uuid NOT NULL REFERENCES companies(id),
  discount_applied_paise bigint NOT NULL,
  redeemed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coupon_redemptions_company ON coupon_redemptions(company_id, redeemed_at DESC);
