-- Phase SMTP+OTP: One-time password storage for email/phone verification flows.
-- OTPs are hashed (bcrypt) before storage. Never store plaintext OTPs.
-- Expiry, single-use, max-attempts, and rate limiting are all enforced
-- in application code (server/otpService.js); this table is the durable store.

CREATE TABLE IF NOT EXISTS otp_codes (
  id               BIGSERIAL PRIMARY KEY,

  -- owning organisation (NULL for platform-level OTPs, e.g. super-admin flows)
  organization_id  BIGINT REFERENCES organizations(id) ON DELETE CASCADE,

  -- linked user (NULL until OTP is wired into registration/password-reset flows)
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,

  -- the email address or phone number this OTP was issued to
  identifier       TEXT NOT NULL,

  -- logical purpose, e.g. 'email_verify', 'password_reset', 'phone_verify'
  context          TEXT NOT NULL,

  -- bcrypt hash of the 6-digit numeric OTP — never store plaintext
  otp_hash         TEXT NOT NULL,

  -- hard expiry — application rejects verifications after this timestamp
  expires_at       TIMESTAMPTZ NOT NULL,

  -- set when the OTP is successfully verified (marks it consumed)
  verified_at      TIMESTAMPTZ,

  -- set when superseded by a newer OTP, or explicitly cancelled
  invalidated_at   TIMESTAMPTZ,

  -- number of verification attempts made against this OTP record
  attempts         INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup for active OTP check: find the latest valid OTP for (identifier, context)
CREATE INDEX IF NOT EXISTS otp_codes_identifier_context_idx
  ON otp_codes (identifier, context);

-- Efficient pruning / expiry queries
CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx
  ON otp_codes (expires_at);

-- Rate-limiting query index: count recent OTPs by identifier + context + created_at window
CREATE INDEX IF NOT EXISTS otp_codes_rate_limit_idx
  ON otp_codes (identifier, context, created_at DESC);

COMMENT ON TABLE otp_codes IS 'Hashed single-use OTP codes for email/phone verification. Plaintext OTPs are never stored.';
COMMENT ON COLUMN otp_codes.identifier IS 'Email address or phone number the OTP was issued to.';
COMMENT ON COLUMN otp_codes.context IS 'Purpose of the OTP: email_verify, password_reset, phone_verify, etc.';
COMMENT ON COLUMN otp_codes.otp_hash IS 'bcrypt hash of the 6-digit numeric OTP. Never plaintext.';
COMMENT ON COLUMN otp_codes.expires_at IS 'Hard expiry timestamp. OTP is invalid after this point regardless of attempts.';
COMMENT ON COLUMN otp_codes.verified_at IS 'Set when the OTP is successfully verified. A non-NULL value marks the OTP as consumed.';
COMMENT ON COLUMN otp_codes.invalidated_at IS 'Set when this OTP is superseded by a newer request or explicitly cancelled.';
COMMENT ON COLUMN otp_codes.attempts IS 'Number of verification attempts against this OTP record. Invalidated at 3 failed attempts.';
