-- Migration: Caretaker login field additions and email optionality
ALTER TABLE users ADD COLUMN IF NOT EXISTS caretaker_pin_hash TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
