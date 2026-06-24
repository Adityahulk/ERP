-- ═══════════════════════════════════════════════════════════════
-- Migration: 050_barcode_scan_inventory.sql
-- Thermal Invoice + Barcode Scanner module.
--
-- The core tables already exist (items.barcode, barcode_registry,
-- item_stock, stock_movements). This migration adds the safety nets
-- and analytics columns needed for the new "scan to deduct stock"
-- workflow:
--   1. DB-level guard so stock can never go negative, even if two
--      scans race each other (defense-in-depth; the controller also
--      checks this inside a transaction with FOR UPDATE).
--   2. DB-level uniqueness for barcodes per company (the application
--      already de-dupes via barcode_num_seq, this just makes it a
--      hard guarantee).
--   3. Lightweight "last scanned" analytics directly on items, so the
--      Barcode Scanner UI can show recency without scanning the full
--      stock_movements ledger.
--   4. An index tuned for the barcode-history lookup
--      (movement_type = 'barcode_scan_out').
-- ═══════════════════════════════════════════════════════════════

-- 1. Prevent negative stock at the database level.
ALTER TABLE item_stock
  ADD CONSTRAINT item_stock_quantity_nonnegative CHECK (quantity >= 0);

-- 2. Enforce barcode uniqueness per company (NULLs are always allowed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_company_barcode
  ON items (company_id, barcode)
  WHERE barcode IS NOT NULL AND is_deleted = false;

-- 3. Scan analytics columns on items.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_count integer NOT NULL DEFAULT 0;

-- 4. Fast lookup for the Barcode History view.
CREATE INDEX IF NOT EXISTS idx_stock_movements_barcode_scan
  ON stock_movements (company_id, created_at DESC)
  WHERE movement_type = 'barcode_scan_out';
