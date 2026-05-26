CREATE TABLE IF NOT EXISTS bulk_sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  bulk_invoice_number varchar(80) NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  generated_date date NOT NULL DEFAULT CURRENT_DATE,
  is_gst_bill boolean NOT NULL DEFAULT true,
  payment_status varchar(20) NOT NULL DEFAULT 'unpaid',
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_invoice_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  total_lines integer NOT NULL DEFAULT 0,
  taxable_amount integer NOT NULL DEFAULT 0,
  tax_amount integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  is_deleted boolean DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bulk_sales_invoices_number
  ON bulk_sales_invoices(company_id, bulk_invoice_number)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_bulk_sales_invoices_company_date
  ON bulk_sales_invoices(company_id, generated_date DESC, is_deleted);

CREATE INDEX IF NOT EXISTS idx_bulk_sales_invoices_party_period
  ON bulk_sales_invoices(company_id, party_id, from_date, to_date)
  WHERE is_deleted = false;
