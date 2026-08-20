-- Migration: 034_hikvision_cameras.sql
-- Description: Add brand column to property_cameras for Hikvision ISAPI support

ALTER TABLE property_cameras
ADD COLUMN IF NOT EXISTS brand VARCHAR(50) NOT NULL DEFAULT 'dahua';

CREATE INDEX IF NOT EXISTS idx_property_cameras_brand ON property_cameras(brand);
