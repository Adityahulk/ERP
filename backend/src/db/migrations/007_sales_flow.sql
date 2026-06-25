-- Sale Orders
CREATE TABLE sale_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  party_id                uuid REFERENCES parties(id),
  so_number               varchar(100) NOT NULL,
  so_date                 date NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date  date,
  status                  varchar(30) NOT NULL DEFAULT 'draft', -- draft/confirmed/partial/fulfilled/cancelled
  payment_terms           varchar(100),
  notes                   text,
  total_amount            bigint NOT NULL DEFAULT 0,
  party_name_snapshot     varchar(255),
  party_gstin_snapshot    varchar(20),
  party_address_snapshot  text,
  created_by              uuid REFERENCES users(id),
  is_deleted              boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sale_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES items(id),
  item_name       varchar(255) NOT NULL,
  hsn_code        varchar(20),
  unit            varchar(50),
  quantity_ordered   numeric(15,3) NOT NULL,
  quantity_fulfilled numeric(15,3) NOT NULL DEFAULT 0,
  unit_price      bigint NOT NULL,
  gst_rate        numeric(5,2) NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sale_orders_updated_at
  BEFORE UPDATE ON sale_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_sale_orders_company ON sale_orders(company_id, so_date, is_deleted);
CREATE INDEX idx_sale_orders_party   ON sale_orders(company_id, party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_sale_orders_status  ON sale_orders(company_id, status);
CREATE INDEX idx_sale_order_items    ON sale_order_items(order_id);

-- Delivery Challans
CREATE TABLE delivery_challans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  party_id                uuid REFERENCES parties(id),
  so_id                   uuid REFERENCES sale_orders(id),
  challan_number          varchar(100) NOT NULL,
  challan_date            date NOT NULL DEFAULT CURRENT_DATE,
  due_date                date,
  status                  varchar(30) NOT NULL DEFAULT 'open', -- open/dispatched/delivered/converted/cancelled
  transport_name          varchar(255),
  vehicle_number          varchar(50),
  lr_number               varchar(100),
  notes                   text,
  total_amount            bigint NOT NULL DEFAULT 0,
  invoice_id              uuid REFERENCES invoices(id),
  party_name_snapshot     varchar(255),
  party_gstin_snapshot    varchar(20),
  party_address_snapshot  text,
  created_by              uuid REFERENCES users(id),
  is_deleted              boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_challan_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id      uuid NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES items(id),
  so_item_id      uuid REFERENCES sale_order_items(id),
  item_name       varchar(255) NOT NULL,
  hsn_code        varchar(20),
  unit            varchar(50),
  quantity        numeric(15,3) NOT NULL,
  unit_price      bigint NOT NULL,
  gst_rate        numeric(5,2) NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER delivery_challans_updated_at
  BEFORE UPDATE ON delivery_challans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_delivery_challans_company  ON delivery_challans(company_id, challan_date, is_deleted);
CREATE INDEX idx_delivery_challans_party    ON delivery_challans(company_id, party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_delivery_challans_status   ON delivery_challans(company_id, status);
CREATE INDEX idx_delivery_challan_items     ON delivery_challan_items(challan_id);

-- Sale Returns / Credit Notes
CREATE TABLE sale_returns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  party_id             uuid REFERENCES parties(id),
  invoice_id           uuid REFERENCES invoices(id),
  credit_note_number   varchar(100) NOT NULL,
  return_date          date NOT NULL DEFAULT CURRENT_DATE,
  reason               text,
  total_amount         bigint NOT NULL DEFAULT 0,
  party_name_snapshot  varchar(255),
  created_by           uuid REFERENCES users(id),
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sale_return_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES items(id),
  item_name   varchar(255) NOT NULL,
  hsn_code    varchar(20),
  unit        varchar(50),
  quantity    numeric(15,3) NOT NULL,
  unit_price  bigint NOT NULL,
  gst_rate    numeric(5,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sale_returns_updated_at
  BEFORE UPDATE ON sale_returns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_sale_returns_company ON sale_returns(company_id, return_date, is_deleted);
CREATE INDEX idx_sale_returns_party   ON sale_returns(company_id, party_id) WHERE party_id IS NOT NULL;
CREATE INDEX idx_sale_return_items    ON sale_return_items(return_id);
