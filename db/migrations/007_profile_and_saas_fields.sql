-- Migration: Add Profile & SaaS Fields to Organizations Table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_start_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
