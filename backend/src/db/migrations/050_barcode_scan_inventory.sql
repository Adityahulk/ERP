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
--
-- Repair first: if any legacy row already has negative quantity (from
-- before this guard existed — e.g. an old over-sell bug, or manual data
-- entry), the ADD CONSTRAINT below would fail outright, and because
-- each migration runs in its own transaction, that failure rolls back
-- this entire migration and halts every migration after it in the
-- sequence. Clamping negative rows to 0 is the conservative repair —
-- there's no way to know what the "correct" positive value should have
-- been, so we don't guess at one; this just removes the impossible
-- negative state and logs what was touched in a real audit movement,
-- not a silent fix.
DO $$
DECLARE
  affected_count integer;
BEGIN
  SELECT COUNT(*) INTO affected_count FROM item_stock WHERE quantity < 0;
  IF affected_count > 0 THEN
    RAISE NOTICE 'Repairing % item_stock row(s) with negative quantity before adding the non-negative constraint', affected_count;

    INSERT INTO stock_movements (company_id, item_id, godown_id, movement_type, reference_type, quantity, balance_after, notes)
    SELECT company_id, item_id, godown_id, 'data_repair', 'migration_050_repair', -quantity, 0,
           'Auto-repaired negative stock (was ' || quantity || ') before adding non-negative constraint'
    FROM item_stock WHERE quantity < 0;

    UPDATE item_stock SET quantity = 0, updated_at = now() WHERE quantity < 0;
  END IF;
END $$;

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
