-- Password reset tokens for email/password users.
-- Raw reset tokens are never stored. The application stores a SHA-256 hash
-- of the high-entropy token and enforces expiry and single-use semantics.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash         TEXT NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  requested_ip       TEXT,
  requested_user_agent TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON password_reset_tokens (expires_at);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON password_reset_tokens (user_id, created_at DESC);

COMMENT ON TABLE password_reset_tokens IS 'Single-use password reset tokens. Only SHA-256 token hashes are stored.';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'SHA-256 hash of the raw reset token. Never store plaintext tokens.';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'Hard expiry timestamp. Tokens are invalid after this point.';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'Set when consumed or superseded. A non-NULL value makes the token unusable.';
