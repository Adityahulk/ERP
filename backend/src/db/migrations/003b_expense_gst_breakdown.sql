-- Expense GST split (CGST/SGST/IGST) for compliance with invoice/quotation rounding rules.
-- amount_includes_gst: when true, `amount` input at create time was total paid; stored `amount` is always taxable (base) in paise after normalisation.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cgst_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_includes_gst boolean NOT NULL DEFAULT false;

-- Best-effort backfill for rows created before this migration (assume intra-state split).
UPDATE expenses
SET
  cgst_amount = CASE WHEN COALESCE(gst_amount, 0) > 0 THEN ROUND(gst_amount::numeric / 2)::integer ELSE 0 END,
  sgst_amount = CASE WHEN COALESCE(gst_amount, 0) > 0 THEN gst_amount - ROUND(gst_amount::numeric / 2)::integer ELSE 0 END,
  igst_amount = 0
WHERE (cgst_amount = 0 AND sgst_amount = 0 AND igst_amount = 0 AND COALESCE(gst_amount, 0) > 0);
