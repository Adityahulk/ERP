-- ═══════════════════════════════════════════════════════════════
-- BizFlow Accounts — Complete Initial Schema
-- Migration: 001_initial_schema.sql
-- All money values stored in PAISE (₹1 = 100 paise)
-- All dates stored as UTC, displayed in IST (Asia/Kolkata)
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- UTILITY: updated_at trigger function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════════
-- 1. PLATFORM & AUTH
-- ═══════════════════════════════════════════════════════════════

-- ─── Companies ────────────────────────────────────────────────
CREATE TABLE companies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            varchar(500) NOT NULL,
  legal_name      varchar(500),
  business_type   varchar(100),
  gstin           varchar(15),
  pan             varchar(10),
  registered_address text,
  city            varchar(200),
  state           varchar(200),
  pincode         varchar(10),
  state_code      varchar(5),
  phone           varchar(20),
  email           varchar(200),
  website         varchar(500),
  logo_url        varchar(500),
  signature_url   varchar(500),

  -- Financial settings
  financial_year_start integer DEFAULT 4,
  invoice_prefix       varchar(20) DEFAULT 'INV',
  po_prefix            varchar(20) DEFAULT 'PO',
  quotation_prefix     varchar(20) DEFAULT 'QT',
  default_due_days     integer DEFAULT 30,
  currency             varchar(5)  DEFAULT 'INR',
  timezone             varchar(50) DEFAULT 'Asia/Kolkata',

  -- Item terminology (customizable per business)
  item_terminology        varchar(100) DEFAULT 'Product',
  item_terminology_plural varchar(100) DEFAULT 'Products',
  default_gst_rate        integer DEFAULT 18,
  default_hsn             varchar(20),

  -- Bank details
  bank_name            varchar(200),
  bank_account_number  varchar(50),
  bank_ifsc            varchar(20),
  bank_branch          varchar(200),
  upi_id               varchar(100),

  -- Document defaults
  terms_and_conditions text,
  invoice_notes        text,

  -- Plan / Subscription
  plan_type             varchar(20)  DEFAULT 'free',
  plan_expires_at       timestamptz,
  onboarding_completed  boolean DEFAULT false,
  is_active             boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Users ────────────────────────────────────────────────────
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  name           varchar(500) NOT NULL,
  email          varchar(200),
  phone          varchar(20),
  password_hash  varchar(500) NOT NULL,
  role           varchar(20)  DEFAULT 'staff',
  avatar_url     varchar(500),
  is_active      boolean DEFAULT true,
  last_login_at  timestamptz,
  password_reset_token   varchar(200),
  password_reset_expires timestamptz,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_users_company ON users(company_id, is_deleted);
CREATE UNIQUE INDEX idx_users_email_company ON users(company_id, email) WHERE email IS NOT NULL AND is_deleted = false;


-- ─── Godowns (Warehouses / Branches) ─────────────────────────
CREATE TABLE godowns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        varchar(500) NOT NULL,
  code        varchar(20),
  address     text,
  city        varchar(200),
  state       varchar(200),
  pincode     varchar(10),
  gstin       varchar(15),
  phone       varchar(20),
  manager_id  uuid REFERENCES users(id),
  is_default  boolean DEFAULT false,
  is_active   boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER godowns_updated_at
  BEFORE UPDATE ON godowns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_godowns_company ON godowns(company_id, is_deleted);


-- ═══════════════════════════════════════════════════════════════
-- 2. ITEM MASTER
-- ═══════════════════════════════════════════════════════════════

-- ─── Item Categories ──────────────────────────────────────────
CREATE TABLE item_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        varchar(500) NOT NULL,
  parent_id   uuid REFERENCES item_categories(id),
  description text,
  is_active   boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER item_categories_updated_at
  BEFORE UPDATE ON item_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_item_categories_company ON item_categories(company_id, is_deleted);


-- ─── Item Units ───────────────────────────────────────────────
CREATE TABLE item_units (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  name         varchar(50) NOT NULL,
  abbreviation varchar(10),
  is_default   boolean DEFAULT false,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER item_units_updated_at
  BEFORE UPDATE ON item_units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Items ────────────────────────────────────────────────────
CREATE TABLE items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  name           varchar(500) NOT NULL,
  description    text,
  sku            varchar(200),
  barcode        varchar(200),
  hsn_code       varchar(20),
  category_id    uuid REFERENCES item_categories(id),
  brand          varchar(200),
  unit_id        uuid REFERENCES item_units(id),
  secondary_unit_id     uuid REFERENCES item_units(id),
  unit_conversion_factor numeric(10,4),

  item_type      varchar(20) DEFAULT 'product',
  track_inventory boolean DEFAULT true,
  is_serialized   boolean DEFAULT false,
  has_variants    boolean DEFAULT false,

  -- Pricing (paise)
  purchase_price  integer DEFAULT 0,
  selling_price   integer DEFAULT 0,

  -- Tax
  tax_preference  varchar(20) DEFAULT 'taxable',
  gst_rate        integer DEFAULT 18,
  cgst_rate       numeric(5,2),
  sgst_rate       numeric(5,2),
  igst_rate       numeric(5,2),
  cess_rate       numeric(5,2) DEFAULT 0,

  -- Accounting
  purchase_account varchar(100),
  sales_account    varchar(100),

  -- Opening stock
  opening_stock        integer DEFAULT 0,
  opening_stock_value  integer DEFAULT 0,
  opening_stock_date   date,

  -- Reorder
  reorder_point    integer DEFAULT 0,
  max_stock_level  integer DEFAULT 0,

  image_url        varchar(500),
  is_active        boolean DEFAULT true,
  custom_fields    jsonb DEFAULT '{}',

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_items_company ON items(company_id, is_deleted, is_active);
CREATE INDEX idx_items_sku ON items(company_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_items_barcode ON items(company_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_items_category ON items(company_id, category_id) WHERE is_deleted = false;


-- ─── Item Stock (per godown) ──────────────────────────────────
CREATE TABLE item_stock (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  item_id           uuid NOT NULL REFERENCES items(id),
  godown_id         uuid NOT NULL REFERENCES godowns(id),
  quantity          integer NOT NULL DEFAULT 0,
  reserved_quantity integer DEFAULT 0,
  available_quantity integer GENERATED ALWAYS AS (quantity - reserved_quantity) STORED,
  avg_cost_price    integer DEFAULT 0,
  updated_at        timestamptz DEFAULT now(),

  UNIQUE(item_id, godown_id)
);

CREATE INDEX idx_item_stock_item_godown ON item_stock(item_id, godown_id);
CREATE INDEX idx_item_stock_company ON item_stock(company_id);


-- ─── Item Batches ─────────────────────────────────────────────
CREATE TABLE item_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  item_id           uuid NOT NULL REFERENCES items(id),
  batch_number      varchar(200) NOT NULL,
  manufacturing_date date,
  expiry_date       date,
  quantity          integer DEFAULT 0,
  purchase_price    integer DEFAULT 0,
  godown_id         uuid REFERENCES godowns(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER item_batches_updated_at
  BEFORE UPDATE ON item_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Item Serial Numbers ─────────────────────────────────────
CREATE TABLE item_serial_numbers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  item_id             uuid NOT NULL REFERENCES items(id),
  serial_number       varchar(200) NOT NULL,
  status              varchar(20) DEFAULT 'available',
  purchase_invoice_id uuid,
  sale_invoice_id     uuid,
  godown_id           uuid REFERENCES godowns(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER item_serial_numbers_updated_at
  BEFORE UPDATE ON item_serial_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_serial_numbers_item ON item_serial_numbers(company_id, item_id);
CREATE UNIQUE INDEX idx_serial_number_unique ON item_serial_numbers(company_id, item_id, serial_number);


-- ─── Stock Movements ─────────────────────────────────────────
CREATE TABLE stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  item_id         uuid NOT NULL REFERENCES items(id),
  godown_id       uuid REFERENCES godowns(id),
  movement_type   varchar(30) NOT NULL,
  reference_type  varchar(30),
  reference_id    uuid,
  quantity        integer NOT NULL,
  unit_cost       integer DEFAULT 0,
  balance_after   integer,
  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_stock_movements_item ON stock_movements(item_id, created_at);
CREATE INDEX idx_stock_movements_company ON stock_movements(company_id, created_at);
CREATE INDEX idx_stock_movements_ref ON stock_movements(reference_type, reference_id);


-- ─── Stock Transfers ─────────────────────────────────────────
CREATE TABLE stock_transfers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  transfer_number  varchar(100),
  from_godown_id   uuid REFERENCES godowns(id),
  to_godown_id     uuid REFERENCES godowns(id),
  status           varchar(20) DEFAULT 'draft',
  transfer_date    date NOT NULL,
  received_date    date,
  notes            text,
  created_by       uuid REFERENCES users(id),
  received_by      uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER stock_transfers_updated_at
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Stock Transfer Items ─────────────────────────────────────
CREATE TABLE stock_transfer_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id       uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES items(id),
  quantity_sent     integer NOT NULL,
  quantity_received integer DEFAULT 0,
  notes             text
);


-- ─── Stock Adjustments ───────────────────────────────────────
CREATE TABLE stock_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  godown_id        uuid REFERENCES godowns(id),
  adjustment_date  date NOT NULL,
  reason           varchar(200),
  notes            text,
  status           varchar(20) DEFAULT 'draft',
  approved_by      uuid REFERENCES users(id),
  created_by       uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER stock_adjustments_updated_at
  BEFORE UPDATE ON stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Stock Adjustment Items ──────────────────────────────────
CREATE TABLE stock_adjustment_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id     uuid NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES items(id),
  current_quantity  integer,
  adjusted_quantity integer,
  difference        integer GENERATED ALWAYS AS (adjusted_quantity - current_quantity) STORED,
  reason            varchar(200)
);


-- ═══════════════════════════════════════════════════════════════
-- 3. PARTIES (CUSTOMERS & SUPPLIERS)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE parties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  party_type        varchar(20) NOT NULL,
  name              varchar(500) NOT NULL,
  display_name      varchar(500),
  gstin             varchar(15),
  pan               varchar(10),
  phone             varchar(20),
  alternate_phone   varchar(20),
  email             varchar(200),
  billing_address   text,
  billing_city      varchar(200),
  billing_state     varchar(200),
  billing_pincode   varchar(10),
  billing_state_code varchar(5),
  shipping_address  text,
  shipping_city     varchar(200),
  shipping_state    varchar(200),
  shipping_pincode  varchar(10),
  credit_limit      integer DEFAULT 0,
  credit_days       integer DEFAULT 0,
  opening_balance   integer DEFAULT 0,
  opening_balance_type varchar(10) DEFAULT 'debit',
  notes             text,
  is_active         boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER parties_updated_at
  BEFORE UPDATE ON parties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_parties_company_type ON parties(company_id, party_type, is_deleted);
CREATE INDEX idx_parties_name ON parties(company_id, name) WHERE is_deleted = false;
CREATE INDEX idx_parties_gstin ON parties(company_id, gstin) WHERE gstin IS NOT NULL AND is_deleted = false;


-- ═══════════════════════════════════════════════════════════════
-- 4. SALES
-- ═══════════════════════════════════════════════════════════════

-- ─── Invoices ─────────────────────────────────────────────────
CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  godown_id      uuid REFERENCES godowns(id),
  invoice_type   varchar(20) DEFAULT 'tax_invoice',
  invoice_number varchar(100) NOT NULL,
  invoice_date   date NOT NULL,
  due_date       date,

  party_id               uuid REFERENCES parties(id),
  party_name_snapshot    varchar(500),
  party_gstin_snapshot   varchar(15),
  billing_address_snapshot  text,
  shipping_address_snapshot text,

  place_of_supply  varchar(5),
  is_interstate    boolean DEFAULT false,

  -- Amounts (all in paise)
  subtotal        integer DEFAULT 0,
  discount_type   varchar(10) DEFAULT 'none',
  discount_value  integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  taxable_amount  integer DEFAULT 0,
  cgst_amount     integer DEFAULT 0,
  sgst_amount     integer DEFAULT 0,
  igst_amount     integer DEFAULT 0,
  cess_amount     integer DEFAULT 0,
  tcs_amount      integer DEFAULT 0,
  round_off       integer DEFAULT 0,
  total_amount    integer DEFAULT 0,
  paid_amount     integer DEFAULT 0,
  balance_due     integer GENERATED ALWAYS AS (total_amount - paid_amount) STORED,

  payment_status  varchar(20) DEFAULT 'unpaid',
  payment_mode    varchar(30),
  status          varchar(20) DEFAULT 'draft',

  -- E-Invoice
  irn               varchar(200),
  ack_number        varchar(100),
  ack_date          timestamptz,
  einvoice_status   varchar(20) DEFAULT 'not_applicable',
  qr_code_url       varchar(500),

  -- Meta
  salesperson_id  uuid REFERENCES users(id),
  notes           text,
  terms_and_conditions text,
  template_id     uuid,
  created_by      uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_invoices_company_date ON invoices(company_id, invoice_date, is_deleted);
CREATE INDEX idx_invoices_party ON invoices(company_id, party_id);
CREATE INDEX idx_invoices_payment_status ON invoices(company_id, payment_status);
CREATE INDEX idx_invoices_number ON invoices(company_id, invoice_number) WHERE is_deleted = false;


-- ─── Invoice Items ────────────────────────────────────────────
CREATE TABLE invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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
  serial_number    varchar(200),
  batch_id         uuid REFERENCES item_batches(id),
  sort_order       integer DEFAULT 0
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_item ON invoice_items(item_id) WHERE item_id IS NOT NULL;


-- ─── Payments ─────────────────────────────────────────────────
CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  payment_type     varchar(20) NOT NULL,
  payment_number   varchar(100),
  payment_date     date NOT NULL,
  party_id         uuid REFERENCES parties(id),
  amount           integer NOT NULL,
  payment_mode     varchar(30) NOT NULL,
  reference_number varchar(200),
  bank_account     varchar(200),
  notes            text,
  created_by       uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_payments_company ON payments(company_id, payment_date, is_deleted);
CREATE INDEX idx_payments_party ON payments(company_id, party_id);


-- ─── Payment Allocations ─────────────────────────────────────
CREATE TABLE payment_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  amount      integer NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations(invoice_id);


-- ─── Quotations ───────────────────────────────────────────────
CREATE TABLE quotations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  godown_id         uuid REFERENCES godowns(id),
  quotation_number  varchar(100) NOT NULL,
  quotation_date    date NOT NULL,
  valid_until       date,
  party_id          uuid REFERENCES parties(id),
  party_name_override  varchar(500),
  party_phone_override varchar(20),
  party_email_override varchar(100),

  subtotal        integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  taxable_amount  integer DEFAULT 0,
  cgst_amount     integer DEFAULT 0,
  sgst_amount     integer DEFAULT 0,
  igst_amount     integer DEFAULT 0,
  total_amount    integer DEFAULT 0,

  status              varchar(20) DEFAULT 'draft',
  converted_to_invoice_id uuid REFERENCES invoices(id),
  customer_notes      text,
  internal_notes      text,
  terms_and_conditions text,
  created_by          uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER quotations_updated_at
  BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_quotations_company ON quotations(company_id, quotation_date, is_deleted);


-- ─── Quotation Items ──────────────────────────────────────────
CREATE TABLE quotation_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id     uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_id          uuid REFERENCES items(id),
  item_name        varchar(500),
  item_description text,
  hsn_code         varchar(20),
  unit             varchar(50),
  quantity         numeric(10,3),
  unit_price       integer,
  discount_type    varchar(10),
  discount_value   numeric(10,2),
  discount_amount  integer,
  taxable_amount   integer,
  gst_rate         integer,
  cgst_rate        numeric(5,2),
  sgst_rate        numeric(5,2),
  igst_rate        numeric(5,2),
  cgst_amount      integer,
  sgst_amount      integer,
  igst_amount      integer,
  total_amount     integer,
  sort_order       integer DEFAULT 0
);

CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);


-- ═══════════════════════════════════════════════════════════════
-- 5. PURCHASE
-- ═══════════════════════════════════════════════════════════════

-- ─── Purchase Orders ──────────────────────────────────────────
CREATE TABLE purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  godown_id       uuid REFERENCES godowns(id),
  po_number       varchar(100) NOT NULL,
  po_date         date NOT NULL,
  expected_date   date,
  party_id        uuid REFERENCES parties(id),
  party_name_snapshot varchar(500),

  subtotal        integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  taxable_amount  integer DEFAULT 0,
  cgst_amount     integer DEFAULT 0,
  sgst_amount     integer DEFAULT 0,
  igst_amount     integer DEFAULT 0,
  total_amount    integer DEFAULT 0,

  status     varchar(20) DEFAULT 'draft',
  notes      text,
  created_by uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_purchase_orders_company ON purchase_orders(company_id, po_date, is_deleted);


-- ─── Purchase Order Items ─────────────────────────────────────
CREATE TABLE purchase_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id           uuid REFERENCES items(id),
  item_name         varchar(500),
  hsn_code          varchar(20),
  unit              varchar(50),
  quantity_ordered  numeric(10,3),
  quantity_received numeric(10,3) DEFAULT 0,
  unit_price        integer,
  discount_amount   integer DEFAULT 0,
  gst_rate          integer,
  cgst_rate         numeric(5,2),
  sgst_rate         numeric(5,2),
  igst_rate         numeric(5,2),
  cgst_amount       integer DEFAULT 0,
  sgst_amount       integer DEFAULT 0,
  igst_amount       integer DEFAULT 0,
  total_amount      integer DEFAULT 0
);

CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);


-- ─── Purchase Invoices (Supplier Bills) ───────────────────────
CREATE TABLE purchase_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  godown_id       uuid REFERENCES godowns(id),
  bill_number     varchar(200) NOT NULL,
  bill_date       date NOT NULL,
  po_id           uuid REFERENCES purchase_orders(id),
  party_id        uuid REFERENCES parties(id),

  subtotal        integer DEFAULT 0,
  discount_amount integer DEFAULT 0,
  taxable_amount  integer DEFAULT 0,
  cgst_amount     integer DEFAULT 0,
  sgst_amount     integer DEFAULT 0,
  igst_amount     integer DEFAULT 0,
  tds_amount      integer DEFAULT 0,
  total_amount    integer DEFAULT 0,
  paid_amount     integer DEFAULT 0,
  payment_status  varchar(20) DEFAULT 'unpaid',
  status          varchar(20) DEFAULT 'draft',
  notes           text,
  created_by      uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER purchase_invoices_updated_at
  BEFORE UPDATE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_purchase_invoices_company ON purchase_invoices(company_id, bill_date);
CREATE INDEX idx_purchase_invoices_party ON purchase_invoices(company_id, party_id);


-- ─── Purchase Invoice Items ──────────────────────────────────
CREATE TABLE purchase_invoice_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  item_id             uuid REFERENCES items(id),
  item_name           varchar(500),
  hsn_code            varchar(20),
  unit                varchar(50),
  quantity            numeric(10,3),
  unit_price          integer,
  discount_amount     integer DEFAULT 0,
  gst_rate            integer,
  cgst_rate           numeric(5,2),
  sgst_rate           numeric(5,2),
  igst_rate           numeric(5,2),
  cgst_amount         integer DEFAULT 0,
  sgst_amount         integer DEFAULT 0,
  igst_amount         integer DEFAULT 0,
  total_amount        integer DEFAULT 0,
  batch_id            uuid REFERENCES item_batches(id),
  serial_numbers      text[]
);

CREATE INDEX idx_purchase_invoice_items_pi ON purchase_invoice_items(purchase_invoice_id);


-- ═══════════════════════════════════════════════════════════════
-- 6. ACCOUNTING
-- ═══════════════════════════════════════════════════════════════

-- ─── Chart of Accounts ───────────────────────────────────────
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  name            varchar(200) NOT NULL,
  code            varchar(50),
  account_type    varchar(30) NOT NULL,
  account_subtype varchar(50),
  parent_id       uuid REFERENCES accounts(id),
  opening_balance      integer DEFAULT 0,
  opening_balance_date date,
  is_system       boolean DEFAULT false,
  description     text,
  is_active       boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_accounts_company ON accounts(company_id, account_type, is_deleted);


-- ─── Journal Entries ──────────────────────────────────────────
CREATE TABLE journal_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  entry_number    varchar(100),
  entry_date      date NOT NULL,
  entry_type      varchar(30) DEFAULT 'manual',
  reference_type  varchar(30),
  reference_id    uuid,
  description     text NOT NULL,
  total_debit     integer DEFAULT 0,
  total_credit    integer DEFAULT 0,
  status          varchar(20) DEFAULT 'posted',
  reversed_by     uuid REFERENCES journal_entries(id),
  created_by      uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER journal_entries_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_journal_entries_company ON journal_entries(company_id, entry_date, is_deleted);


-- ─── Journal Entry Lines ─────────────────────────────────────
CREATE TABLE journal_entry_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  debit       integer DEFAULT 0,
  credit      integer DEFAULT 0,
  description text,
  party_id    uuid REFERENCES parties(id),
  sort_order  integer DEFAULT 0
);

CREATE INDEX idx_journal_lines_entry ON journal_entry_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_entry_lines(account_id);


-- ─── Expenses ─────────────────────────────────────────────────
CREATE TABLE expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  godown_id        uuid REFERENCES godowns(id),
  expense_number   varchar(100),
  expense_date     date NOT NULL,
  category         varchar(200) NOT NULL,
  description      text,
  amount           integer NOT NULL,
  tax_amount       integer DEFAULT 0,
  total_amount     integer,
  payment_mode     varchar(30),
  vendor_name      varchar(200),
  vendor_gstin     varchar(15),
  hsn_code         varchar(20),
  gst_rate         integer DEFAULT 0,
  bill_number      varchar(200),
  bill_date        date,
  bill_url         varchar(500),
  account_id       uuid REFERENCES accounts(id),
  approved_by      uuid REFERENCES users(id),
  status           varchar(20) DEFAULT 'pending',
  notes            text,
  created_by       uuid REFERENCES users(id),

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_expenses_company ON expenses(company_id, expense_date, is_deleted);


-- ═══════════════════════════════════════════════════════════════
-- 7. HR & ATTENDANCE
-- ═══════════════════════════════════════════════════════════════

-- ─── Employee Profiles ───────────────────────────────────────
CREATE TABLE employee_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  user_id              uuid REFERENCES users(id) UNIQUE,
  employee_code        varchar(50),
  designation          varchar(200),
  department           varchar(100),
  godown_id            uuid REFERENCES godowns(id),
  joining_date         date NOT NULL,
  employment_type      varchar(30) DEFAULT 'full_time',
  annual_salary        integer,
  salary_type          varchar(20) DEFAULT 'monthly',
  bank_name            varchar(200),
  bank_account_number  varchar(50),
  bank_ifsc            varchar(20),
  pan_number           varchar(10),
  aadhar_last4         varchar(4),
  emergency_contact_name  varchar(200),
  emergency_contact_phone varchar(20),
  probation_end_date   date,
  resignation_date     date,
  is_active            boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER employee_profiles_updated_at
  BEFORE UPDATE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_employee_profiles_company ON employee_profiles(company_id, is_deleted);


-- ─── Leave Types ──────────────────────────────────────────────
CREATE TABLE leave_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  name             varchar(200) NOT NULL,
  code             varchar(10),
  days_per_year    integer DEFAULT 0,
  is_paid          boolean DEFAULT true,
  carry_forward    boolean DEFAULT false,
  max_carry_forward integer DEFAULT 0,
  is_active        boolean DEFAULT true,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TRIGGER leave_types_updated_at
  BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ─── Leave Applications ──────────────────────────────────────
CREATE TABLE leave_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  godown_id       uuid REFERENCES godowns(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  leave_type_id   uuid REFERENCES leave_types(id),
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  total_days       numeric(4,1),
  half_day        boolean DEFAULT false,
  half_day_session varchar(10),
  reason          text NOT NULL,
  status          varchar(20) DEFAULT 'pending',
  reviewed_by     uuid REFERENCES users(id),
  review_note     text,
  reviewed_at     timestamptz,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  is_deleted  boolean DEFAULT false
);

CREATE TRIGGER leave_applications_updated_at
  BEFORE UPDATE ON leave_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_leave_applications_company ON leave_applications(company_id, status);
CREATE INDEX idx_leave_applications_user ON leave_applications(user_id, from_date);


-- ─── Attendance ───────────────────────────────────────────────
CREATE TABLE attendance (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  godown_id            uuid REFERENCES godowns(id),
  user_id              uuid NOT NULL REFERENCES users(id),
  date                 date NOT NULL,
  clock_in             timestamptz,
  clock_out            timestamptz,
  status               varchar(20) DEFAULT 'present',
  working_hours        numeric(4,2) GENERATED ALWAYS AS (
    CASE
      WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0, 2)
      ELSE NULL
    END
  ) STORED,
  is_regularized       boolean DEFAULT false,
  regularized_by       uuid REFERENCES users(id),
  leave_application_id uuid REFERENCES leave_applications(id),
  notes                text,

  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  UNIQUE(user_id, date)
);

CREATE TRIGGER attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX idx_attendance_company ON attendance(company_id, date);


-- ═══════════════════════════════════════════════════════════════
-- 8. NOTIFICATIONS & AUDIT
-- ═══════════════════════════════════════════════════════════════

-- ─── Notification Logs ───────────────────────────────────────
CREATE TABLE notification_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  recipient_phone  varchar(20),
  recipient_name   varchar(200),
  channel          varchar(20) NOT NULL,
  message_type     varchar(50),
  reference_type   varchar(30),
  reference_id     uuid,
  message_body     text,
  status           varchar(20) DEFAULT 'pending',
  provider_id      varchar(200),
  error_message    text,
  triggered_by     uuid REFERENCES users(id),
  sent_at          timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_notification_logs_company ON notification_logs(company_id, created_at);


-- ─── Audit Logs ──────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  user_id     uuid REFERENCES users(id),
  action      varchar(50) NOT NULL,
  entity      varchar(50) NOT NULL,
  entity_id   uuid,
  old_value   jsonb,
  new_value   jsonb,
  ip_address  varchar(50),
  user_agent  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_logs_company_entity ON audit_logs(company_id, entity, created_at);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at);


-- ═══════════════════════════════════════════════════════════════
-- COMPLETE ✅
-- ═══════════════════════════════════════════════════════════════
