CREATE TABLE IF NOT EXISTS license_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES licenses(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  registrant_id uuid NOT NULL REFERENCES registrants(id),
  current_tier_id uuid NOT NULL REFERENCES license_tiers(id),
  target_tier_id uuid NOT NULL REFERENCES license_tiers(id),
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  provider varchar(50) NOT NULL DEFAULT 'upi',
  provider_order_id varchar(120) UNIQUE,
  provider_payment_id varchar(200),
  status varchar(30) NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_license_payment_orders_company ON license_payment_orders(company_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_license_payment_orders_status ON license_payment_orders(status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_license_payment_orders_provider_order ON license_payment_orders(provider_order_id) WHERE is_deleted = false;

CREATE TRIGGER license_payment_orders_updated_at
  BEFORE UPDATE ON license_payment_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
