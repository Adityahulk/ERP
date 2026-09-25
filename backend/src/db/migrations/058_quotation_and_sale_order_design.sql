-- Rich Quotation and Sales Order defaults, snapshots, tax totals and addresses.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS quotation_validity_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS sale_order_delivery_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS quotation_terms_template text,
  ADD COLUMN IF NOT EXISTS sale_order_terms_template text;

UPDATE companies
SET quotation_validity_days = 14
WHERE quotation_validity_days IS NULL OR quotation_validity_days < 1 OR quotation_validity_days > 365;

UPDATE companies
SET sale_order_delivery_days = 14
WHERE sale_order_delivery_days IS NULL OR sale_order_delivery_days < 1 OR sale_order_delivery_days > 365;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS godown_id uuid REFERENCES godowns(id),
  ADD COLUMN IF NOT EXISTS is_interstate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_terms text,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS terms_and_conditions text,
  ADD COLUMN IF NOT EXISTS party_phone_snapshot varchar(30),
  ADD COLUMN IF NOT EXISTS party_email_snapshot varchar(200),
  ADD COLUMN IF NOT EXISTS party_state_snapshot varchar(200),
  ADD COLUMN IF NOT EXISTS party_state_code_snapshot varchar(5),
  ADD COLUMN IF NOT EXISTS billing_recipient_name varchar(500),
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS billing_city varchar(200),
  ADD COLUMN IF NOT EXISTS billing_state varchar(200),
  ADD COLUMN IF NOT EXISTS billing_state_code varchar(5),
  ADD COLUMN IF NOT EXISTS billing_pincode varchar(10),
  ADD COLUMN IF NOT EXISTS billing_country varchar(100) NOT NULL DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS shipping_same_as_billing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shipping_recipient_name varchar(500),
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS shipping_city varchar(200),
  ADD COLUMN IF NOT EXISTS shipping_state varchar(200),
  ADD COLUMN IF NOT EXISTS shipping_state_code varchar(5),
  ADD COLUMN IF NOT EXISTS shipping_pincode varchar(10),
  ADD COLUMN IF NOT EXISTS shipping_country varchar(100) NOT NULL DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS subtotal_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount bigint NOT NULL DEFAULT 0;

ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS item_description text,
  ADD COLUMN IF NOT EXISTS taxable_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_rate numeric(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate numeric(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_rate numeric(7,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount bigint NOT NULL DEFAULT 0;

ALTER TABLE sale_order_items
  ALTER COLUMN gst_rate TYPE numeric(7,3) USING gst_rate::numeric;

-- Preserve old orders while making their stored print summaries accurate.
UPDATE sale_order_items
SET taxable_amount = GREATEST(0, ROUND(quantity_ordered * unit_price)::bigint - discount_amount),
    cgst_rate = gst_rate / 2,
    sgst_rate = gst_rate / 2,
    cgst_amount = ROUND(GREATEST(0, quantity_ordered * unit_price - discount_amount) * gst_rate / 200)::bigint,
    sgst_amount = ROUND(GREATEST(0, quantity_ordered * unit_price - discount_amount) * gst_rate / 100)::bigint
      - ROUND(GREATEST(0, quantity_ordered * unit_price - discount_amount) * gst_rate / 200)::bigint,
    total_amount = ROUND(GREATEST(0, quantity_ordered * unit_price - discount_amount) * (1 + gst_rate / 100))::bigint
WHERE total_amount = 0;

UPDATE sale_orders o
SET subtotal_amount = totals.subtotal,
    discount_amount = totals.discount,
    taxable_amount = totals.taxable,
    cgst_amount = totals.cgst,
    sgst_amount = totals.sgst,
    igst_amount = totals.igst,
    total_amount = totals.total
FROM (
  SELECT order_id,
         COALESCE(SUM(ROUND(quantity_ordered * unit_price)), 0)::bigint AS subtotal,
         COALESCE(SUM(discount_amount), 0)::bigint AS discount,
         COALESCE(SUM(taxable_amount), 0)::bigint AS taxable,
         COALESCE(SUM(cgst_amount), 0)::bigint AS cgst,
         COALESCE(SUM(sgst_amount), 0)::bigint AS sgst,
         COALESCE(SUM(igst_amount), 0)::bigint AS igst,
         COALESCE(SUM(total_amount), 0)::bigint AS total
  FROM sale_order_items
  GROUP BY order_id
) totals
WHERE totals.order_id = o.id;

