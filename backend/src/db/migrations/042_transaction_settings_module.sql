CREATE TABLE IF NOT EXISTS transaction_settings (
  firm_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  show_invoice_number boolean NOT NULL DEFAULT true,
  add_time_on_transactions boolean NOT NULL DEFAULT false,
  cash_sale_by_default boolean NOT NULL DEFAULT false,
  show_billing_name_of_parties boolean NOT NULL DEFAULT false,
  show_customer_po_details boolean NOT NULL DEFAULT false,
  show_inclusive_exclusive_tax boolean NOT NULL DEFAULT true,
  show_purchase_price_in_items boolean NOT NULL DEFAULT true,
  show_last5_sale_price boolean NOT NULL DEFAULT false,
  show_last5_purchase_price boolean NOT NULL DEFAULT false,
  show_free_item_quantity boolean NOT NULL DEFAULT false,
  show_count_column boolean NOT NULL DEFAULT false,
  count_column_label varchar(30) NOT NULL DEFAULT 'Count',
  enable_transaction_wise_tax boolean NOT NULL DEFAULT false,
  enable_transaction_wise_discount boolean NOT NULL DEFAULT false,
  round_off_total boolean NOT NULL DEFAULT true,
  round_off_type varchar(10) NOT NULL DEFAULT 'NEAREST' CHECK (round_off_type IN ('NEAREST','FLOOR','CEIL')),
  round_off_to int NOT NULL DEFAULT 1 CHECK (round_off_to IN (1,10,100)),
  enable_eway_bill boolean NOT NULL DEFAULT false,
  enable_quick_entry boolean NOT NULL DEFAULT false,
  do_not_show_invoice_preview boolean NOT NULL DEFAULT false,
  enable_passcode_for_edit_delete boolean NOT NULL DEFAULT false,
  enable_discount_during_payments boolean NOT NULL DEFAULT false,
  link_payments_to_invoices boolean NOT NULL DEFAULT false,
  enable_due_dates_and_payment_terms boolean NOT NULL DEFAULT false,
  show_profit_while_making_sale_invoice boolean NOT NULL DEFAULT false,
  enable_terms_and_conditions boolean NOT NULL DEFAULT true,
  billing_type varchar(20) NOT NULL DEFAULT 'FULL_SALE' CHECK (billing_type IN ('LITE_SALE','FULL_SALE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_prefixes (
  firm_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  sale varchar(10),
  credit_note varchar(10),
  sale_order varchar(10),
  purchase_order varchar(10),
  estimate varchar(10),
  proforma_invoice varchar(10),
  delivery_challan varchar(10),
  payment_in varchar(10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE transaction_terms_type AS ENUM (
    'SALE','PURCHASE_ORDER','PURCHASE_BILL','PROFORMA_INVOICE','ESTIMATE_QUOTATION','DELIVERY_CHALLAN','SALE_ORDER','PAYMENT_IN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS terms_and_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transaction_type transaction_terms_type NOT NULL,
  title varchar(100) NOT NULL,
  content text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS terms_one_default_per_type
  ON terms_and_conditions(firm_id, transaction_type)
  WHERE is_default = true;

CREATE TABLE IF NOT EXISTS additional_fields_config (
  firm_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  invoice_theme varchar(20) NOT NULL DEFAULT 'THEME_1',
  firm_field1_enabled boolean NOT NULL DEFAULT false,
  firm_field1_label varchar(50),
  firm_field2_enabled boolean NOT NULL DEFAULT false,
  firm_field2_label varchar(50),
  txn_field1_enabled boolean NOT NULL DEFAULT false,
  txn_field1_label varchar(50),
  txn_field2_enabled boolean NOT NULL DEFAULT false,
  txn_field2_label varchar(50),
  txn_field3_enabled boolean NOT NULL DEFAULT false,
  txn_field3_label varchar(50),
  txn_date_field_enabled boolean NOT NULL DEFAULT false,
  txn_date_field_label varchar(50),
  show_on_sales boolean NOT NULL DEFAULT false,
  show_on_purchase boolean NOT NULL DEFAULT false,
  show_on_expense boolean NOT NULL DEFAULT false,
  show_on_payment_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transportation_details_config (
  firm_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  field1_label varchar(50) NOT NULL DEFAULT 'Transport Name',
  field1_enabled boolean NOT NULL DEFAULT false,
  field1_show_in_print boolean NOT NULL DEFAULT true,
  field2_label varchar(50) NOT NULL DEFAULT 'Vehicle Number',
  field2_enabled boolean NOT NULL DEFAULT false,
  field2_show_in_print boolean NOT NULL DEFAULT true,
  field3_label varchar(50) NOT NULL DEFAULT 'Delivery Date',
  field3_enabled boolean NOT NULL DEFAULT false,
  field3_show_in_print boolean NOT NULL DEFAULT true,
  field4_label varchar(50) NOT NULL DEFAULT 'Delivery Location',
  field4_enabled boolean NOT NULL DEFAULT false,
  field4_show_in_print boolean NOT NULL DEFAULT true,
  field5_label varchar(50) NOT NULL DEFAULT 'Field 5',
  field5_enabled boolean NOT NULL DEFAULT false,
  field5_show_in_print boolean NOT NULL DEFAULT true,
  field6_label varchar(50) NOT NULL DEFAULT 'Field 6',
  field6_enabled boolean NOT NULL DEFAULT false,
  field6_show_in_print boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS additional_charges_config (
  firm_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  master_enabled boolean NOT NULL DEFAULT false,
  charge1_label varchar(50) NOT NULL DEFAULT 'Shipping',
  charge1_enabled boolean NOT NULL DEFAULT false,
  charge1_sac_code varchar(6),
  charge1_tax_rate numeric(7,3),
  charge1_tax_enabled boolean NOT NULL DEFAULT false,
  charge2_label varchar(50) NOT NULL DEFAULT 'Packaging',
  charge2_enabled boolean NOT NULL DEFAULT false,
  charge2_sac_code varchar(6),
  charge2_tax_rate numeric(7,3),
  charge2_tax_enabled boolean NOT NULL DEFAULT false,
  charge3_label varchar(50) NOT NULL DEFAULT 'Adjustment',
  charge3_enabled boolean NOT NULL DEFAULT false,
  charge3_sac_code varchar(6),
  charge3_tax_rate numeric(7,3),
  charge3_tax_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
