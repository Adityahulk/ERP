CREATE TABLE IF NOT EXISTS item_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  base_unit_id uuid NOT NULL REFERENCES item_units(id) ON DELETE CASCADE,
  secondary_unit_id uuid NOT NULL REFERENCES item_units(id) ON DELETE CASCADE,
  factor numeric(12,4) NOT NULL CHECK (factor > 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, base_unit_id, secondary_unit_id)
);

CREATE TRIGGER item_unit_conversions_updated_at
  BEFORE UPDATE ON item_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

WITH default_units(name, abbreviation, is_default) AS (
  VALUES
    ('Bags', 'Bag', false),
    ('Bottles', 'Btl', false),
    ('Box', 'Box', false),
    ('Bundles', 'Bdl', false),
    ('Cans', 'Can', false),
    ('Cartons', 'Ctn', false),
    ('Dozens', 'Dzn', false),
    ('Grammes', 'Gm', false),
    ('Kilograms', 'Kg', false),
    ('Litre', 'Ltr', false),
    ('Meters', 'Mtr', false),
    ('Centimeters', 'Cm', false),
    ('Millilitre', 'Ml', false),
    ('Numbers', 'Nos', false),
    ('Packs', 'Pac', false),
    ('Pairs', 'Prs', false),
    ('Pieces', 'Pcs', true),
    ('Rolls', 'Rol', false),
    ('Sets', 'Set', false),
    ('Tonnes', 'Ton', false)
)
INSERT INTO item_units (company_id, name, abbreviation, is_default)
SELECT c.id, du.name, du.abbreviation, du.is_default
FROM companies c
CROSS JOIN default_units du
WHERE COALESCE(c.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM item_units iu
    WHERE iu.company_id = c.id
      AND (LOWER(TRIM(iu.name)) = LOWER(TRIM(du.name))
        OR LOWER(TRIM(COALESCE(iu.abbreviation, ''))) = LOWER(TRIM(du.abbreviation)))
  );

WITH default_categories(name, description) AS (
  VALUES
    ('General', 'Default item category'),
    ('Grocery', 'Food, grains and daily-use goods'),
    ('Electronics', 'Electronic items and accessories'),
    ('Clothing', 'Garments, textiles and apparel'),
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

WITH conversion_defs(base_abbr, factor, secondary_abbr) AS (
  VALUES
    ('Kg', 1000::numeric, 'Gm'),
    ('Ltr', 1000::numeric, 'Ml'),
    ('Mtr', 100::numeric, 'Cm'),
    ('Dzn', 12::numeric, 'Pcs'),
    ('Ton', 1000::numeric, 'Kg')
),
unit_pairs AS (
  SELECT c.id AS company_id, bu.id AS base_unit_id, cd.factor, su.id AS secondary_unit_id
  FROM companies c
  JOIN conversion_defs cd ON true
  JOIN item_units bu ON bu.company_id = c.id AND LOWER(TRIM(COALESCE(bu.abbreviation, ''))) = LOWER(cd.base_abbr)
  JOIN item_units su ON su.company_id = c.id AND LOWER(TRIM(COALESCE(su.abbreviation, ''))) = LOWER(cd.secondary_abbr)
  WHERE COALESCE(c.is_deleted, false) = false
)
INSERT INTO item_unit_conversions (company_id, base_unit_id, factor, secondary_unit_id)
SELECT company_id, base_unit_id, factor, secondary_unit_id
FROM unit_pairs
ON CONFLICT (company_id, base_unit_id, secondary_unit_id) DO NOTHING;

