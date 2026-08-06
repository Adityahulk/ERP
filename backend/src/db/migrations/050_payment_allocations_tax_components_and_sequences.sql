-- Close accounting workflow gaps discovered during the billing audit.

ALTER TABLE payment_allocations
  ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES purchase_invoices(id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase_invoice
  ON payment_allocations(purchase_invoice_id)
  WHERE purchase_invoice_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_allocations_exactly_one_document'
  ) THEN
    ALTER TABLE payment_allocations
      ADD CONSTRAINT payment_allocations_exactly_one_document
      CHECK ((invoice_id IS NOT NULL)::int + (purchase_invoice_id IS NOT NULL)::int = 1);
  END IF;
END $$;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS tax_option_id varchar(100);

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS tax_components jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Item settings allow up to four decimal places. Keep that precision across
-- every document and stock workflow instead of accepting it only on screen.
ALTER TABLE invoice_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE quotation_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE purchase_order_items
  ALTER COLUMN quantity_ordered TYPE numeric(15,4) USING quantity_ordered::numeric(15,4),
  ALTER COLUMN quantity_received TYPE numeric(15,4) USING quantity_received::numeric(15,4);
ALTER TABLE purchase_invoice_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE sale_order_items
  ALTER COLUMN quantity_ordered TYPE numeric(15,4) USING quantity_ordered::numeric(15,4),
  ALTER COLUMN quantity_fulfilled TYPE numeric(15,4) USING quantity_fulfilled::numeric(15,4);
ALTER TABLE delivery_challan_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE sale_return_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE production_logs
  ALTER COLUMN quantity_produced TYPE numeric(15,4) USING quantity_produced::numeric(15,4);
ALTER TABLE wholesale_order_items
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4);
ALTER TABLE job_work_challan_items
  ALTER COLUMN quantity_sent TYPE numeric(15,4) USING quantity_sent::numeric(15,4),
  ALTER COLUMN quantity_received TYPE numeric(15,4) USING quantity_received::numeric(15,4),
  ALTER COLUMN quantity_rejected TYPE numeric(15,4) USING quantity_rejected::numeric(15,4),
  ALTER COLUMN wastage TYPE numeric(15,4) USING wastage::numeric(15,4);

CREATE TABLE IF NOT EXISTS document_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type varchar(40) NOT NULL,
  financial_year varchar(20) NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, document_type, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_document_sequences_company
  ON document_sequences(company_id, document_type);

-- Existing firms predate configurable transaction prefixes. Preserve their
-- current invoice prefix when the settings row was lazily created with NULL.
UPDATE transaction_prefixes tp
SET sale = COALESCE(NULLIF(c.invoice_prefix, ''), 'INV')
FROM companies c
WHERE tp.firm_id = c.id
  AND tp.sale IS NULL;
