-- Keep refresh-session state in PostgreSQL so Redis remains an optional cache.
-- This prevents a Redis outage or read-only replica from breaking login.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS refresh_token_hash varchar(64),
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_refresh_token_expiry
  ON users (refresh_token_expires_at)
  WHERE refresh_token_hash IS NOT NULL AND is_deleted = false;
