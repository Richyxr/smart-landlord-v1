-- Phase 8: Notification retry tracking and background processing columns.
-- Adds columns to track retry attempts for failed sends in notification_logs.

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN notification_logs.retry_count IS 'Number of times sending this notification has been attempted.';
COMMENT ON COLUMN notification_logs.max_retries IS 'Maximum number of delivery attempts permitted before giving up.';
COMMENT ON COLUMN notification_logs.last_attempt_at IS 'Timestamp of the most recent delivery attempt.';
