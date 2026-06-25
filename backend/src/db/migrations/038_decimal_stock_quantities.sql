-- Allow fractional item quantities across inventory and stock ledgers.
-- Existing integer values remain valid; the wider numeric scale supports item settings
-- that allow decimal quantity entry without breaking stock movement accounting.

ALTER TABLE items
  ALTER COLUMN opening_stock TYPE numeric(15,4) USING COALESCE(opening_stock, 0)::numeric(15,4),
  ALTER COLUMN reorder_point TYPE numeric(15,4) USING COALESCE(reorder_point, 0)::numeric(15,4),
  ALTER COLUMN max_stock_level TYPE numeric(15,4) USING COALESCE(max_stock_level, 0)::numeric(15,4);

ALTER TABLE item_stock
  DROP COLUMN IF EXISTS available_quantity;

ALTER TABLE item_stock
  ALTER COLUMN quantity TYPE numeric(15,4) USING COALESCE(quantity, 0)::numeric(15,4),
  ALTER COLUMN reserved_quantity TYPE numeric(15,4) USING COALESCE(reserved_quantity, 0)::numeric(15,4);

ALTER TABLE item_stock
  ADD COLUMN available_quantity numeric(15,4)
  GENERATED ALWAYS AS (quantity - reserved_quantity) STORED;

ALTER TABLE item_batches
  ALTER COLUMN quantity TYPE numeric(15,4) USING COALESCE(quantity, 0)::numeric(15,4);

ALTER TABLE stock_movements
  ALTER COLUMN quantity TYPE numeric(15,4) USING quantity::numeric(15,4),
  ALTER COLUMN balance_after TYPE numeric(15,4) USING balance_after::numeric(15,4);

ALTER TABLE stock_transfer_items
  ALTER COLUMN quantity_sent TYPE numeric(15,4) USING quantity_sent::numeric(15,4),
  ALTER COLUMN quantity_received TYPE numeric(15,4) USING COALESCE(quantity_received, 0)::numeric(15,4);

ALTER TABLE stock_adjustment_items
  DROP COLUMN IF EXISTS difference;

ALTER TABLE stock_adjustment_items
  ALTER COLUMN current_quantity TYPE numeric(15,4) USING current_quantity::numeric(15,4),
  ALTER COLUMN adjusted_quantity TYPE numeric(15,4) USING adjusted_quantity::numeric(15,4);

ALTER TABLE stock_adjustment_items
  ADD COLUMN difference numeric(15,4)
  GENERATED ALWAYS AS (adjusted_quantity - current_quantity) STORED;

ALTER TABLE wholesale_price_tiers
  ALTER COLUMN min_quantity TYPE numeric(15,4) USING min_quantity::numeric(15,4);
