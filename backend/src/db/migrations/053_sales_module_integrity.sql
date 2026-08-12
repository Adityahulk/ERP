-- Repair duplicate item masters before enforcing company-scoped uniqueness.

CREATE TEMP TABLE category_merge_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY company_id, LOWER(TRIM(name))
           ORDER BY created_at NULLS LAST, id
         ) AS keep_id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, LOWER(TRIM(name))
           ORDER BY created_at NULLS LAST, id
         ) AS row_no
  FROM item_categories
  WHERE is_deleted = false
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE row_no > 1;

UPDATE items i
SET category_id = m.keep_id
FROM category_merge_map m
WHERE i.category_id = m.drop_id;

UPDATE item_categories c
SET parent_id = m.keep_id
FROM category_merge_map m
WHERE c.parent_id = m.drop_id;

UPDATE item_categories
SET parent_id = NULL
WHERE parent_id = id;

UPDATE item_categories keep
SET is_active = keep.is_active OR duplicate.is_active,
    description = COALESCE(NULLIF(keep.description, ''), duplicate.description)
FROM category_merge_map m
JOIN item_categories duplicate ON duplicate.id = m.drop_id
WHERE keep.id = m.keep_id;

DELETE FROM item_categories duplicate
USING category_merge_map m
WHERE duplicate.id = m.drop_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_categories_company_name_active
  ON item_categories (company_id, LOWER(TRIM(name)))
  WHERE is_deleted = false;

-- Units can be duplicates by either full name or abbreviation. Treat both
-- relationships as one connected component so chains are merged safely.
CREATE TEMP TABLE unit_merge_map ON COMMIT DROP AS
WITH RECURSIVE links AS (
  SELECT a.id AS source_id, b.id AS linked_id
  FROM item_units a
  JOIN item_units b
    ON b.company_id = a.company_id
   AND (
     LOWER(TRIM(b.name)) = LOWER(TRIM(a.name))
     OR (
       NULLIF(LOWER(TRIM(COALESCE(a.abbreviation, ''))), '') IS NOT NULL
       AND LOWER(TRIM(COALESCE(b.abbreviation, ''))) = LOWER(TRIM(COALESCE(a.abbreviation, '')))
     )
   )
), reach AS (
  SELECT source_id, linked_id FROM links
  UNION
  SELECT r.source_id, l.linked_id
  FROM reach r
  JOIN links l ON l.source_id = r.linked_id
), canonical AS (
  SELECT source_id, MIN(linked_id::text)::uuid AS keep_id
  FROM reach
  GROUP BY source_id
)
SELECT source_id AS drop_id, keep_id
FROM canonical
WHERE source_id <> keep_id;

CREATE TEMP TABLE conversion_merge_rows ON COMMIT DROP AS
SELECT c.company_id,
       COALESCE(base_map.keep_id, c.base_unit_id) AS base_unit_id,
       COALESCE(secondary_map.keep_id, c.secondary_unit_id) AS secondary_unit_id,
       MAX(c.factor) AS factor
FROM item_unit_conversions c
LEFT JOIN unit_merge_map base_map ON base_map.drop_id = c.base_unit_id
LEFT JOIN unit_merge_map secondary_map ON secondary_map.drop_id = c.secondary_unit_id
GROUP BY c.company_id,
         COALESCE(base_map.keep_id, c.base_unit_id),
         COALESCE(secondary_map.keep_id, c.secondary_unit_id);

DELETE FROM item_unit_conversions c
USING unit_merge_map m
WHERE c.base_unit_id = m.drop_id OR c.secondary_unit_id = m.drop_id;

UPDATE items i
SET unit_id = m.keep_id
FROM unit_merge_map m
WHERE i.unit_id = m.drop_id;

UPDATE items i
SET secondary_unit_id = m.keep_id
FROM unit_merge_map m
WHERE i.secondary_unit_id = m.drop_id;

UPDATE item_units keep
SET is_default = true
WHERE EXISTS (
  SELECT 1
  FROM unit_merge_map m
  JOIN item_units duplicate ON duplicate.id = m.drop_id
  WHERE m.keep_id = keep.id AND duplicate.is_default = true
);

DELETE FROM item_units duplicate
USING unit_merge_map m
WHERE duplicate.id = m.drop_id;

INSERT INTO item_unit_conversions (company_id, base_unit_id, secondary_unit_id, factor)
SELECT company_id, base_unit_id, secondary_unit_id, factor
FROM conversion_merge_rows
WHERE base_unit_id <> secondary_unit_id
ON CONFLICT (company_id, base_unit_id, secondary_unit_id)
DO UPDATE SET factor = EXCLUDED.factor, updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_units_company_name
  ON item_units (company_id, LOWER(TRIM(name)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_units_company_abbreviation
  ON item_units (company_id, LOWER(TRIM(abbreviation)))
  WHERE NULLIF(TRIM(COALESCE(abbreviation, '')), '') IS NOT NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS einvoice_error text,
  ADD COLUMN IF NOT EXISTS einvoice_last_attempt_at timestamptz;

-- SKU and barcode identify an item within a company. Preserve the oldest
-- assignment and clear accidental duplicates rather than deleting items that
-- may already be referenced by stock movements or invoices.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, LOWER(TRIM(sku))
           ORDER BY created_at NULLS LAST, id
         ) AS row_no
  FROM items
  WHERE is_deleted = false AND NULLIF(TRIM(COALESCE(sku, '')), '') IS NOT NULL
)
UPDATE items i
SET sku = NULL
FROM ranked r
WHERE i.id = r.id AND r.row_no > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, LOWER(TRIM(barcode))
           ORDER BY created_at NULLS LAST, id
         ) AS row_no
  FROM items
  WHERE is_deleted = false AND NULLIF(TRIM(COALESCE(barcode, '')), '') IS NOT NULL
)
UPDATE items i
SET barcode = NULL
FROM ranked r
WHERE i.id = r.id AND r.row_no > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_company_sku_active
  ON items (company_id, LOWER(TRIM(sku)))
  WHERE is_deleted = false AND NULLIF(TRIM(COALESCE(sku, '')), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_company_barcode_active
  ON items (company_id, LOWER(TRIM(barcode)))
  WHERE is_deleted = false AND NULLIF(TRIM(COALESCE(barcode, '')), '') IS NOT NULL;
