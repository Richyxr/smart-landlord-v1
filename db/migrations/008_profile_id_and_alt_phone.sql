-- Migration: Add ID Number and Alternative Phone Number to Organizations Table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS id_number TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS alt_phone_number TEXT;
