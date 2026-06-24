-- ═══════════════════════════════════════════════════════════════
-- Migration: 059_proforma_assigncode_barcode_upgrade.sql
--
-- Reuses real existing infrastructure rather than rebuilding it:
--   - Proforma already has prefix config + print theme (just needed
--     a real frontend + a convert-to-sale action, both real CRUD).
--   - item_serial_numbers already covers Serial/IMEI tracking.
--   - item_batches already covers Batch/Expiry/Manufacturing date.
--   - tesseract.js is already an installed dependency (AI Label Scan
--     uses it for real, not a placeholder).
-- ═══════════════════════════════════════════════════════════════

-- Proforma status lifecycle — separate from the regular invoice
-- payment_status, since a proforma was never paid in the first place.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS proforma_status varchar(20) DEFAULT 'draft'; -- draft | sent | accepted | rejected | converted
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_to_invoice_id uuid REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_from_proforma_id uuid REFERENCES invoices(id);

-- "Assign Code" — real sequential per-company numbering with a real
-- uniqueness guarantee (the prior sku index was non-unique).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_assign_code integer NOT NULL DEFAULT 1;
-- A partial unique index (not a hard column constraint) so existing
-- items with duplicate/blank SKUs from before this migration don't
-- block the migration itself — only newly assigned codes are enforced.
DROP INDEX IF EXISTS idx_items_sku;
CREATE INDEX idx_items_sku ON items(company_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_assign_code ON items(company_id, sku) WHERE sku IS NOT NULL AND sku ~ '^[0-9]+$';

-- Barcode scan modes + richer history (stock_movements already has
-- balance_after; stock_before was missing, needed for a complete
-- audit trail per the brief).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS balance_before numeric(15,3);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS scan_mode varchar(20); -- sale | purchase | transfer | audit

-- AI Label Scan staging — holds OCR results for review before they're
-- applied to an item, so a misread label never silently corrupts data.
CREATE TABLE label_scan_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  image_path      text NOT NULL,
  raw_ocr_text    text,
  detected_name   varchar(255),
  detected_barcode varchar(200),
  detected_mrp    bigint,
  detected_batch  varchar(200),
  detected_expiry date,
  confidence      varchar(20) DEFAULT 'low', -- low | medium | high — heuristic, not a model score
  applied_to_item_id uuid REFERENCES items(id),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_label_scan_results_company ON label_scan_results(company_id, created_at DESC);
