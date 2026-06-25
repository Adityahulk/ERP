-- Migration: 022_verification_codes.sql
-- Adds OTP/code verification table for email + phone verification, password reset, and login.
-- Single table reused across signup verification, password reset, and any future MFA flows.

CREATE TABLE IF NOT EXISTS verification_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner: either a registrant (license buyer) or an internal user. Exactly one is set.
  registrant_id   uuid REFERENCES registrants(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  -- What is being verified — email address or phone number (in raw form).
  channel         varchar(10) NOT NULL CHECK (channel IN ('email', 'sms')),
  identifier      varchar(255) NOT NULL,             -- email or phone number being verified
  -- What this code is for — drives downstream behaviour.
  purpose         varchar(30) NOT NULL CHECK (purpose IN ('signup_verify', 'password_reset', 'login_2fa', 'change_email')),
  code_hash       varchar(200) NOT NULL,             -- bcrypt of the OTP
  attempts        int NOT NULL DEFAULT 0,            -- failed verification attempts
  max_attempts    int NOT NULL DEFAULT 5,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,                       -- non-null once successfully verified
  last_sent_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Exactly one of registrant_id or user_id must be set
  CONSTRAINT verification_codes_owner_check CHECK (
    (registrant_id IS NOT NULL AND user_id IS NULL) OR
    (registrant_id IS NULL AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_registrant
  ON verification_codes(registrant_id, purpose, consumed_at, expires_at)
  WHERE registrant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_codes_user
  ON verification_codes(user_id, purpose, consumed_at, expires_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
  ON verification_codes(identifier, purpose, consumed_at)
  WHERE consumed_at IS NULL;

-- Phone number column on users (some schemas may already have it). For phone verification later.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_email_verified boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- Registrants: track when verification happened
ALTER TABLE registrants
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_phone_verified boolean NOT NULL DEFAULT false;
