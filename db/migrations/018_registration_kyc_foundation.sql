-- Migration 018: Registration KYC/Profile Completion Foundation

-- 1. Add first_name and last_name columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Update existing users to populate first_name and last_name from name
UPDATE users
SET first_name = split_part(name, ' ', 1),
    last_name = COALESCE(nullif(substring(name from ' (.*)'), ''), '');

-- 2. Add representative and profile completion columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_first_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_last_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_role TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_phone_e164 TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS representative_authorized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS profile_confirmed_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'incomplete'
  CHECK (kyc_status IN ('incomplete', 'completed', 'pending_review', 'verified', 'rejected'));

-- Update existing organizations: mark as completed only if all required fields are present
UPDATE organizations
SET profile_completed = CASE 
      WHEN name IS NOT NULL AND name <> '' AND email IS NOT NULL AND email <> '' AND phone_number IS NOT NULL AND phone_number <> '' 
      THEN TRUE 
      ELSE FALSE 
    END,
    profile_confirmed_at = CASE 
      WHEN name IS NOT NULL AND name <> '' AND email IS NOT NULL AND email <> '' AND phone_number IS NOT NULL AND phone_number <> '' 
      THEN now() 
      ELSE NULL 
    END,
    kyc_status = CASE 
      WHEN name IS NOT NULL AND name <> '' AND email IS NOT NULL AND email <> '' AND phone_number IS NOT NULL AND phone_number <> '' 
      THEN 'completed' 
      ELSE 'incomplete' 
    END;
