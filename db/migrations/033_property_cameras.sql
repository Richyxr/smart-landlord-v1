-- Migration: 033_property_cameras.sql
-- Description: Create property_cameras table for CCTV Dahua IPC integration

CREATE TABLE IF NOT EXISTS property_cameras (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id INT REFERENCES properties(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  ip_address VARCHAR(100) NOT NULL,
  port INT NOT NULL DEFAULT 80,
  rtsp_port INT NOT NULL DEFAULT 554,
  username VARCHAR(100) NOT NULL DEFAULT 'admin',
  password_encrypted TEXT,
  channel_no INT NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_property_cameras_org ON property_cameras(organization_id);
CREATE INDEX IF NOT EXISTS idx_property_cameras_property ON property_cameras(property_id);
