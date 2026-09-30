-- Explicit guard for the item/stock monetary columns reported in production.
-- Values remain whole paise; bigint removes PostgreSQL's 32-bit integer cap.

ALTER TABLE items
  ALTER COLUMN purchase_price TYPE bigint USING purchase_price::bigint,
  ALTER COLUMN selling_price TYPE bigint USING selling_price::bigint,
  ALTER COLUMN opening_stock_value TYPE bigint USING opening_stock_value::bigint;

ALTER TABLE item_stock
  ALTER COLUMN avg_cost_price TYPE bigint USING avg_cost_price::bigint;

ALTER TABLE item_batches
  ALTER COLUMN purchase_price TYPE bigint USING purchase_price::bigint;

ALTER TABLE stock_movements
  ALTER COLUMN unit_cost TYPE bigint USING unit_cost::bigint;

COMMENT ON COLUMN items.opening_stock_value IS 'Opening inventory value stored as integer paise in bigint storage';
COMMENT ON COLUMN item_stock.avg_cost_price IS 'Average unit cost stored as integer paise in bigint storage';
