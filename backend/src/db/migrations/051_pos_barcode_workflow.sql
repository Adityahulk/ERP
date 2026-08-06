-- Persist every scannable item code per company and remember the last label setup.

ALTER TABLE barcode_registry
  ALTER COLUMN barcode TYPE varchar(128);

ALTER TABLE barcode_registry
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE barcode_registry br
SET company_id = i.company_id,
    is_primary = (br.barcode = i.barcode)
FROM items i
WHERE br.item_id = i.id
  AND br.company_id IS NULL;

DELETE FROM barcode_registry WHERE company_id IS NULL;

ALTER TABLE barcode_registry
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE barcode_registry
  DROP CONSTRAINT IF EXISTS barcode_registry_pkey;

ALTER TABLE barcode_registry
  ADD CONSTRAINT barcode_registry_pkey PRIMARY KEY (company_id, barcode);

CREATE INDEX IF NOT EXISTS idx_barcode_registry_barcode
  ON barcode_registry(barcode);

CREATE INDEX IF NOT EXISTS idx_barcode_registry_company_item
  ON barcode_registry(company_id, item_id);

CREATE TABLE IF NOT EXISTS barcode_label_profiles (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_barcode_label_profiles_item
  ON barcode_label_profiles(item_id);
