-- Supplier bill terms and line-level totals required by OCR, aging, and PDF output.
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE purchase_invoice_items
  ADD COLUMN IF NOT EXISTS taxable_amount integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY purchase_invoice_id ORDER BY id) - 1 AS row_no
  FROM purchase_invoice_items
)
UPDATE purchase_invoice_items item
SET sort_order = ranked.row_no
FROM ranked
WHERE item.id = ranked.id;

UPDATE purchase_invoice_items
SET taxable_amount = GREATEST(0, ROUND((COALESCE(unit_price, 0) * COALESCE(quantity, 0)) - COALESCE(discount_amount, 0)))::integer
WHERE COALESCE(taxable_amount, 0) = 0;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_due_date
  ON purchase_invoices(company_id, due_date)
  WHERE is_deleted = false AND payment_status <> 'paid';
