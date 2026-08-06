-- ═══════════════════════════════════════════════════════════════
-- Microtechnique Accounts — Manufacturing, Wholesale & Job Work Extension
-- Migration: 005_manufacturing_wholesale_jobwork.sql
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- ALTER EXISTING TABLES
-- ─────────────────────────────────────────────────────────────

ALTER TABLE companies ADD COLUMN IF NOT EXISTS wholesale_prefix varchar(20) DEFAULT 'WS';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS job_work_prefix varchar(20) DEFAULT 'JW';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bom_prefix varchar(20) DEFAULT 'BOM';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_mode varchar(20) DEFAULT 'manufacturing';


-- ═══════════════════════════════════════════════════════════════
-- 1. BILL OF MATERIALS (BOM)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE bom (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  finished_item_id uuid NOT NULL REFERENCES items(id),
  bom_name         varchar(500),
  bom_number       varchar(100),
  version          integer DEFAULT 1,
  labour_cost      integer DEFAULT 0,
  overhead_cost    integer DEFAULT 0,
  total_cost       integer DEFAULT 0,
  notes            text,
  is_default       boolean DEFAULT false,
  is_active        boolean DEFAULT true,
  created_by       uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER bom_updated_at
  BEFORE UPDATE ON bom
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_bom_company ON bom(company_id, is_deleted);
CREATE INDEX idx_bom_finished_item ON bom(finished_item_id);


CREATE TABLE bom_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id          uuid NOT NULL REFERENCES bom(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items(id),
  item_name       varchar(500),
  quantity        numeric(10,4) NOT NULL,
  unit            varchar(50),
  wastage_percent numeric(5,2) DEFAULT 0,
  unit_cost       integer DEFAULT 0,
  notes           text,
  sort_order      integer DEFAULT 0
);

CREATE INDEX idx_bom_items_bom ON bom_items(bom_id);


-- ─── Production Logs ─────────────────────────────────────────
CREATE TABLE production_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  bom_id           uuid NOT NULL REFERENCES bom(id),
  production_number varchar(100),
  production_date  date NOT NULL,
  godown_id        uuid REFERENCES godowns(id),
  quantity_produced numeric(10,3) NOT NULL,
  labour_cost      integer DEFAULT 0,
  overhead_cost    integer DEFAULT 0,
  total_cost       integer DEFAULT 0,
  notes            text,
  status           varchar(20) DEFAULT 'completed',
  created_by       uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER production_logs_updated_at
  BEFORE UPDATE ON production_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_production_logs_company ON production_logs(company_id, production_date, is_deleted);
CREATE INDEX idx_production_logs_bom ON production_logs(bom_id);


-- ═══════════════════════════════════════════════════════════════
-- 2. WHOLESALE
-- ═══════════════════════════════════════════════════════════════

-- ─── Wholesale Pricing Tiers ─────────────────────────────────
CREATE TABLE wholesale_price_tiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  item_id     uuid NOT NULL REFERENCES items(id),
  min_quantity integer NOT NULL,
  price       integer NOT NULL,
  tier_name   varchar(200),
  is_active   boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER wholesale_price_tiers_updated_at
  BEFORE UPDATE ON wholesale_price_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_wholesale_price_tiers_item ON wholesale_price_tiers(company_id, item_id);


-- ─── Wholesale Orders ────────────────────────────────────────
CREATE TABLE wholesale_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  godown_id         uuid REFERENCES godowns(id),
  order_number      varchar(100) NOT NULL,
  order_date        date NOT NULL,
  expected_delivery date,

  party_id               uuid REFERENCES parties(id),
  party_name_snapshot    varchar(500),
  party_gstin_snapshot   varchar(15),
  billing_address_snapshot  text,
  shipping_address_snapshot text,

  place_of_supply  varchar(5),
  is_interstate    boolean DEFAULT false,

  subtotal        integer DEFAULT 0,
  discount_type   varchar(10) DEFAULT 'none',
  discount_value  integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  taxable_amount  integer DEFAULT 0,
  cgst_amount     integer DEFAULT 0,
  sgst_amount     integer DEFAULT 0,
  igst_amount     integer DEFAULT 0,
  cess_amount     integer DEFAULT 0,
  round_off       integer DEFAULT 0,
  total_amount    integer DEFAULT 0,

  paid_amount     integer DEFAULT 0,
  balance_due     integer GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  payment_status  varchar(20) DEFAULT 'unpaid',
  payment_mode    varchar(30),

  status          varchar(20) DEFAULT 'draft',

  -- Dispatch info
  dispatch_date     date,
  transport_details text,
  lr_number         varchar(200),
  eway_bill_number  varchar(100),
  vehicle_number    varchar(50),

  -- Converted from quotation?
  quotation_id  uuid REFERENCES quotations(id),

  notes           text,
  terms_and_conditions text,
  created_by      uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER wholesale_orders_updated_at
  BEFORE UPDATE ON wholesale_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_wholesale_orders_company ON wholesale_orders(company_id, order_date, is_deleted);
CREATE INDEX idx_wholesale_orders_party ON wholesale_orders(company_id, party_id);
CREATE INDEX idx_wholesale_orders_status ON wholesale_orders(company_id, status);


-- ─── Wholesale Order Items ───────────────────────────────────
CREATE TABLE wholesale_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES wholesale_orders(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL REFERENCES companies(id),
  item_id          uuid REFERENCES items(id),
  item_name        varchar(500) NOT NULL,
  item_description text,
  hsn_code         varchar(20),
  unit             varchar(50),
  quantity         numeric(10,3) NOT NULL,
  unit_price       integer NOT NULL,
  discount_type    varchar(10) DEFAULT 'none',
  discount_value   numeric(10,2) DEFAULT 0,
  discount_amount  integer DEFAULT 0,
  taxable_amount   integer DEFAULT 0,
  gst_rate         integer DEFAULT 0,
  cgst_rate        numeric(5,2) DEFAULT 0,
  sgst_rate        numeric(5,2) DEFAULT 0,
  igst_rate        numeric(5,2) DEFAULT 0,
  cgst_amount      integer DEFAULT 0,
  sgst_amount      integer DEFAULT 0,
  igst_amount      integer DEFAULT 0,
  cess_amount      integer DEFAULT 0,
  total_amount     integer DEFAULT 0,
  tier_applied     varchar(200),
  sort_order       integer DEFAULT 0
);

CREATE INDEX idx_wholesale_order_items_order ON wholesale_order_items(order_id);
CREATE INDEX idx_wholesale_order_items_item ON wholesale_order_items(item_id) WHERE item_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 3. JOB WORK
-- ═══════════════════════════════════════════════════════════════

-- ─── Job Work Challans ───────────────────────────────────────
CREATE TABLE job_work_challans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  challan_number     varchar(100) NOT NULL,
  challan_type       varchar(20) NOT NULL,    -- 'outward' or 'inward'
  challan_date       date NOT NULL,

  party_id           uuid NOT NULL REFERENCES parties(id),
  party_name_snapshot varchar(500),
  party_gstin_snapshot varchar(15),

  godown_id          uuid REFERENCES godowns(id),
  related_challan_id uuid REFERENCES job_work_challans(id),

  -- GST Section 143 compliance
  return_due_date    date,
  is_capital_goods   boolean DEFAULT false,
  is_returned        boolean DEFAULT false,

  -- Charges (for inward / receiving back)
  labour_charges     integer DEFAULT 0,
  other_charges      integer DEFAULT 0,
  gst_on_charges     integer DEFAULT 0,
  total_charges      integer DEFAULT 0,

  -- Amounts (value of materials)
  total_material_value integer DEFAULT 0,

  status             varchar(20) DEFAULT 'draft',
  transport_details  text,
  vehicle_number     varchar(50),
  eway_bill_number   varchar(100),
  notes              text,

  created_by         uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER job_work_challans_updated_at
  BEFORE UPDATE ON job_work_challans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_jw_challans_company ON job_work_challans(company_id, challan_date, is_deleted);
CREATE INDEX idx_jw_challans_party ON job_work_challans(company_id, party_id);
CREATE INDEX idx_jw_challans_type ON job_work_challans(company_id, challan_type);
CREATE INDEX idx_jw_challans_status ON job_work_challans(company_id, status);
CREATE INDEX idx_jw_challans_related ON job_work_challans(related_challan_id) WHERE related_challan_id IS NOT NULL;


-- ─── Job Work Challan Items ──────────────────────────────────
CREATE TABLE job_work_challan_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id        uuid NOT NULL REFERENCES job_work_challans(id) ON DELETE CASCADE,
  item_id           uuid REFERENCES items(id),
  item_name         varchar(500),
  hsn_code          varchar(20),
  unit              varchar(50),
  quantity_sent     numeric(10,3) DEFAULT 0,
  quantity_received numeric(10,3) DEFAULT 0,
  quantity_rejected numeric(10,3) DEFAULT 0,
  wastage           numeric(10,3) DEFAULT 0,
  unit_price        integer DEFAULT 0,
  total_value       integer DEFAULT 0,
  notes             text,
  sort_order        integer DEFAULT 0
);

CREATE INDEX idx_jw_challan_items_challan ON job_work_challan_items(challan_id);
CREATE INDEX idx_jw_challan_items_item ON job_work_challan_items(item_id) WHERE item_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- COMPLETE ✅
-- ═══════════════════════════════════════════════════════════════
