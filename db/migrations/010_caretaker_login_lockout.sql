-- Caretaker PIN login lockout state.
-- Raw PINs remain bcrypt-hashed in caretaker_pin_hash only.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS caretaker_failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caretaker_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS caretaker_last_failed_login_at TIMESTAMPTZ;

COMMENT ON COLUMN users.caretaker_failed_login_attempts IS 'Failed caretaker PIN login attempts since the last successful login or PIN reset.';
COMMENT ON COLUMN users.caretaker_locked_until IS 'Caretaker login is rejected until this timestamp after repeated failed PIN attempts.';
COMMENT ON COLUMN users.caretaker_last_failed_login_at IS 'Timestamp of the most recent failed caretaker PIN login attempt.';
