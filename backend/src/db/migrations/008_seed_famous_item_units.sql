-- Seed popular item units for every company (idempotent)
WITH popular_units(name, abbreviation, priority) AS (
  VALUES
    ('Piece', 'pc', 1),
    ('Kilogram', 'kg', 2),
    ('Gram', 'g', 3),
    ('Litre', 'L', 4),
    ('Millilitre', 'ml', 5),
    ('Meter', 'm', 6),
    ('Centimeter', 'cm', 7),
    ('Box', 'box', 8),
    ('Dozen', 'doz', 9),
    ('Pack', 'pack', 10),
    ('Pair', 'pair', 11),
    ('Unit', 'unit', 12),
    ('Roll', 'roll', 13),
    ('Set', 'set', 14),
    ('Bag', 'bag', 15),
    ('Bottle', 'btl', 16),
    ('Carton', 'ctn', 17),
    ('Ton', 'ton', 18),
    ('Hour', 'hr', 19),
    ('Day', 'day', 20)
)
INSERT INTO item_units (company_id, name, abbreviation, is_default)
SELECT
  c.id,
  pu.name,
  pu.abbreviation,
  pu.priority = 1
FROM companies c
CROSS JOIN popular_units pu
WHERE c.is_deleted = false
  AND NOT EXISTS (
    SELECT 1
    FROM item_units iu
    WHERE iu.company_id = c.id
      AND LOWER(iu.name) = LOWER(pu.name)
  );
