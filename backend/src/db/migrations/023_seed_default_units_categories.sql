-- Seed practical default units and item categories for every active company.
-- Idempotent: safe to run repeatedly and safe for existing companies.

WITH default_units(name, abbreviation, is_default) AS (
  VALUES
    ('Piece', 'pc', true),
    ('Number', 'nos', false),
    ('Kilogram', 'kg', false),
    ('Gram', 'g', false),
    ('Litre', 'L', false),
    ('Millilitre', 'ml', false),
    ('Meter', 'm', false),
    ('Square Feet', 'sq.ft', false),
    ('Box', 'box', false),
    ('Packet', 'pkt', false),
    ('Dozen', 'doz', false),
    ('Pair', 'pair', false),
    ('Roll', 'roll', false),
    ('Bundle', 'bdl', false),
    ('Set', 'set', false),
    ('Bag', 'bag', false),
    ('Carton', 'ctn', false),
    ('Hour', 'hr', false),
    ('Day', 'day', false)
)
INSERT INTO item_units (company_id, name, abbreviation, is_default)
SELECT c.id, du.name, du.abbreviation, du.is_default
FROM companies c
CROSS JOIN default_units du
WHERE COALESCE(c.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM item_units iu
    WHERE iu.company_id = c.id
      AND LOWER(TRIM(iu.name)) = LOWER(TRIM(du.name))
  );

WITH default_categories(name, description) AS (
  VALUES
    ('Raw Materials', 'Materials used for manufacturing or job work'),
    ('Finished Goods', 'Ready-to-sell products'),
    ('Trading Goods', 'Goods bought and sold without further processing'),
    ('Services', 'Service and labour line items'),
    ('Consumables', 'Consumable supplies used in operations'),
    ('Packaging', 'Packing and shipping material'),
    ('Spare Parts', 'Replacement and maintenance parts'),
    ('Office Supplies', 'Office and administrative supplies')
)
INSERT INTO item_categories (company_id, name, description, is_active, is_deleted)
SELECT c.id, dc.name, dc.description, true, false
FROM companies c
CROSS JOIN default_categories dc
WHERE COALESCE(c.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM item_categories ic
    WHERE ic.company_id = c.id
      AND COALESCE(ic.is_deleted, false) = false
      AND LOWER(TRIM(ic.name)) = LOWER(TRIM(dc.name))
  );
