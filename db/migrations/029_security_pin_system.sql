-- Security PIN system for Landlord critical actions.
-- Stores hashed PINs, failed attempts count, lockout timestamp, and verification logs.
-- Reset tokens are stored hashed (SHA-256) and expire.

CREATE TABLE IF NOT EXISTS security_pins (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  organization_id        BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  pin_hash               TEXT NOT NULL,
  pin_set_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  pin_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  pin_failed_attempts    INTEGER NOT NULL DEFAULT 0,
  pin_locked_until       TIMESTAMPTZ,
  pin_last_verified_at   TIMESTAMPTZ,
  pin_reset_required     BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_pin_reset_tokens (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash             TEXT NOT NULL UNIQUE,
  expires_at             TIMESTAMPTZ NOT NULL,
  used_at                TIMESTAMPTZ,
  requested_ip           TEXT,
  requested_user_agent   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_pin_reset_tokens_token_hash_idx
  ON security_pin_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS security_pin_reset_tokens_expires_at_idx
  ON security_pin_reset_tokens (expires_at);

COMMENT ON TABLE security_pins IS 'Stores bcrypt-hashed PINs and lock state/attempts for landlords.';
COMMENT ON TABLE security_pin_reset_tokens IS 'Stores SHA-256 hashed security PIN reset tokens.';
