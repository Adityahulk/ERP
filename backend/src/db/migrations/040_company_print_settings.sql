ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS print_settings jsonb DEFAULT '{}'::jsonb;
