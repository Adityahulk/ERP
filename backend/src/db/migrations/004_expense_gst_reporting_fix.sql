-- Ensure expense GST split columns exist and are internally consistent for reporting.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cgst_amount integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_includes_gst boolean DEFAULT false;

UPDATE expenses
SET
  tax_amount = COALESCE(tax_amount, 0),
  gst_amount = COALESCE(gst_amount, 0),
  cgst_amount = COALESCE(cgst_amount, 0),
  sgst_amount = COALESCE(sgst_amount, 0),
  igst_amount = COALESCE(igst_amount, 0),
  total_amount = COALESCE(total_amount, COALESCE(amount, 0) + COALESCE(gst_amount, 0)),
  amount_includes_gst = COALESCE(amount_includes_gst, false);

ALTER TABLE expenses
  ALTER COLUMN gst_amount SET DEFAULT 0,
  ALTER COLUMN cgst_amount SET DEFAULT 0,
  ALTER COLUMN sgst_amount SET DEFAULT 0,
  ALTER COLUMN igst_amount SET DEFAULT 0,
  ALTER COLUMN amount_includes_gst SET DEFAULT false;

ALTER TABLE expenses
  ALTER COLUMN gst_amount SET NOT NULL,
  ALTER COLUMN cgst_amount SET NOT NULL,
  ALTER COLUMN sgst_amount SET NOT NULL,
  ALTER COLUMN igst_amount SET NOT NULL,
  ALTER COLUMN amount_includes_gst SET NOT NULL;

WITH normalized AS (
  SELECT
    e.id,
    COALESCE(e.gst_amount, 0) AS gst_amount,
    COALESCE(e.amount, 0) AS amount,
    CASE
      WHEN UPPER(COALESCE(e.vendor_gstin, '')) ~ '^[0-9]{2}' THEN LEFT(UPPER(COALESCE(e.vendor_gstin, '')), 2)
      WHEN UPPER(COALESCE(c.gstin, '')) ~ '^[0-9]{2}' THEN LEFT(UPPER(COALESCE(c.gstin, '')), 2)
      ELSE NULLIF(c.state_code, '')
    END AS supplier_code,
    CASE
      WHEN NULLIF(c.state_code, '') IS NOT NULL THEN NULLIF(c.state_code, '')
      WHEN UPPER(COALESCE(c.gstin, '')) ~ '^[0-9]{2}' THEN LEFT(UPPER(COALESCE(c.gstin, '')), 2)
      WHEN UPPER(COALESCE(e.vendor_gstin, '')) ~ '^[0-9]{2}' THEN LEFT(UPPER(COALESCE(e.vendor_gstin, '')), 2)
      ELSE NULL
    END AS buyer_code
  FROM expenses e
  JOIN companies c ON c.id = e.company_id
),
recalc AS (
  SELECT
    id,
    gst_amount,
    amount,
    CASE
      WHEN gst_amount <= 0 THEN 0
      WHEN supplier_code = buyer_code THEN ROUND(gst_amount::numeric / 2)::integer
      ELSE 0
    END AS cgst_amount,
    CASE
      WHEN gst_amount <= 0 THEN 0
      WHEN supplier_code = buyer_code THEN gst_amount - ROUND(gst_amount::numeric / 2)::integer
      ELSE 0
    END AS sgst_amount,
    CASE
      WHEN gst_amount <= 0 THEN 0
      WHEN supplier_code = buyer_code THEN 0
      ELSE gst_amount
    END AS igst_amount
  FROM normalized
)
UPDATE expenses e
SET
  tax_amount = r.gst_amount,
  gst_amount = r.gst_amount,
  cgst_amount = r.cgst_amount,
  sgst_amount = r.sgst_amount,
  igst_amount = r.igst_amount,
  total_amount = r.amount + r.gst_amount
FROM recalc r
WHERE e.id = r.id
  AND (
    COALESCE(e.tax_amount, 0) <> r.gst_amount OR
    COALESCE(e.gst_amount, 0) <> r.gst_amount OR
    COALESCE(e.cgst_amount, 0) <> r.cgst_amount OR
    COALESCE(e.sgst_amount, 0) <> r.sgst_amount OR
    COALESCE(e.igst_amount, 0) <> r.igst_amount OR
    COALESCE(e.total_amount, 0) <> (r.amount + r.gst_amount)
  );
