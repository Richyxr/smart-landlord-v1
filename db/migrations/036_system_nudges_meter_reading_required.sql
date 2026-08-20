-- Migration: 036_system_nudges_meter_reading_required.sql
-- Description: Extend system_nudges category to include meter_reading_required
--              (used by automated billing engine when readings are missing)

ALTER TABLE system_nudges
  DROP CONSTRAINT IF EXISTS system_nudges_category_check;

ALTER TABLE system_nudges
  ADD CONSTRAINT system_nudges_category_check
  CHECK (category IN (
    'meter_reading',
    'meter_reading_required',
    'billing',
    'reconciliation',
    'lease',
    'maintenance',
    'security',
    'saas'
  ));
