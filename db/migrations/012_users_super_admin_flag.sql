-- Add persistent super admin role flag for user-level RBAC routing.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
