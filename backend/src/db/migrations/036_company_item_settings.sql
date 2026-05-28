ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS item_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS item_custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

