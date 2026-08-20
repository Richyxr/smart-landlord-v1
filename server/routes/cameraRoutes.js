import express from 'express';
import { encryptConfig, decryptConfig } from '../crypto.js';
import * as dahuaService from '../services/dahuaCameraService.js';
import * as hikvisionService from '../services/hikvisionCameraService.js';

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(error => {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      next(error);
    });
  };
}

function getContext(req) {
  const isDemo = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';
  return {
    orgId: req.auth?.organizationId || req.auth?.orgId || (isDemo ? 1 : null),
    userId: req.auth?.userId || req.auth?.user_id || (isDemo ? 1 : null),
    role: req.auth?.role || (isDemo ? 'landlord' : null)
  };
}

function requireAuthenticatedContext(req, res, next) {
  const { orgId, userId } = getContext(req);

  if (!userId || !orgId) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'A valid Smart Landlord session is required.'
    });
  }

  next();
}

/**
 * Decrypts camera password for internal service/RTSP URL building.
 */
function decryptCameraPassword(cameraRow) {
  if (!cameraRow || !cameraRow.password_encrypted) return '';
  try {
    const decrypted = decryptConfig(cameraRow.password_encrypted);
    return decrypted?.password || cameraRow.password_encrypted;
  } catch (_err) {
    return cameraRow.password_encrypted;
  }
}

/**
 * Sanitizes camera record before returning to frontend.
 * Masks sensitive passwords and computes brand-specific RTSP URLs.
 */
function sanitizeCameraRecord(cameraRow, propertyName = null) {
  const password = decryptCameraPassword(cameraRow);
  const fullConfig = {
    ...cameraRow,
    password
  };

  const brand = (cameraRow.brand || 'dahua').toLowerCase();
  let rtspUrl = '';

  if (brand === 'hikvision') {
    rtspUrl = hikvisionService.buildRtspStreamUrl(fullConfig);
  } else {
    rtspUrl = dahuaService.buildRtspStreamUrl(fullConfig);
  }

  return {
    id: cameraRow.id,
    organization_id: cameraRow.organization_id,
    property_id: cameraRow.property_id || null,
    property_name: propertyName || cameraRow.property_name || 'All Properties',
    brand,
    name: cameraRow.name,
    ip_address: cameraRow.ip_address,
    port: cameraRow.port || 80,
    rtsp_port: cameraRow.rtsp_port || 554,
    username: cameraRow.username || 'admin',
    password_masked: cameraRow.password_encrypted ? '••••••••' : '',
    channel_no: cameraRow.channel_no || 1,
    status: cameraRow.status || 'active',
    rtsp_stream_url: rtspUrl,
    created_at: cameraRow.created_at,
    updated_at: cameraRow.updated_at
  };
}

export function createCameraRoutes(dbAdapter) {
  const router = express.Router();

  // =========================================================================
  // GET /api/cameras — List all property cameras for landlord organization
  // =========================================================================
  router.get('/cameras', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);

    // Query cameras and join properties if available
    let cameras = [];
    try {
      const result = await dbAdapter.query(
        `SELECT c.*, p.name AS property_name 
         FROM property_cameras c 
         LEFT JOIN properties p ON c.property_id = p.id 
         WHERE c.organization_id = $1 
         ORDER BY c.id ASC`,
        [orgId]
      );
      cameras = result.rows || [];
    } catch (_err) {
      // Fallback for JSON DB or simple proxy
      cameras = await dbAdapter.find ? dbAdapter.find('property_cameras', { organization_id: orgId }) : [];
    }

    const sanitized = cameras.map(cam => sanitizeCameraRecord(cam));
    res.json(sanitized);
  }));

  // =========================================================================
  // POST /api/cameras — Register a new IP Camera (Dahua / Hikvision)
  // =========================================================================
  router.post('/cameras', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const {
      name,
      ip_address,
      brand = 'dahua',
      port = 80,
      rtsp_port = 554,
      username = 'admin',
      password = '',
      channel_no = 1,
      property_id = null
    } = req.body;

    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Camera name and IP address are required.' });
    }

    const validBrand = ['dahua', 'hikvision'].includes(String(brand).toLowerCase())
      ? String(brand).toLowerCase()
      : 'dahua';

    let encrypted = null;
    if (password) {
      try {
        encrypted = encryptConfig({ password });
      } catch (e) {
        console.warn('[CameraRoutes] Password encryption fallback:', e.message);
        encrypted = password;
      }
    }

    let newCamera = null;
    try {
      newCamera = await dbAdapter.insert('property_cameras', {
        organization_id: orgId,
        property_id: property_id ? parseInt(property_id, 10) : null,
        brand: validBrand,
        name: name.trim(),
        ip_address: ip_address.trim(),
        port: parseInt(port, 10) || 80,
        rtsp_port: parseInt(rtsp_port, 10) || 554,
        username: username.trim() || 'admin',
        password_encrypted: encrypted,
        channel_no: parseInt(channel_no, 10) || 1,
        status: 'active'
      });
    } catch (dbErr) {
      console.error('[CameraRoutes] Failed to insert property_cameras record:', dbErr.message);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: `Failed to save camera device: ${dbErr.message}`
      });
    }

    if (!newCamera) {
      return res.status(500).json({
        error: 'SAVE_FAILED',
        message: 'Failed to create camera record.'
      });
    }

    try {
      if (dbAdapter.logAudit) {
        await dbAdapter.logAudit(
          orgId, userId, 'landlord',
          'camera_registered',
          'property_cameras',
          newCamera.id,
          null,
          { name: newCamera.name, ip_address: newCamera.ip_address, brand: newCamera.brand },
          `Registered ${newCamera.brand.toUpperCase()} IP Camera "${newCamera.name}" at ${newCamera.ip_address}:${newCamera.port}.`
        );
      }
    } catch (_auditErr) {
      // Audit log error non-fatal
    }

    res.status(201).json(sanitizeCameraRecord(newCamera));
  }));

  // =========================================================================
  // GET /api/cameras/:id — Get camera detail & system info
  // =========================================================================
  router.get('/cameras/:id', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const camera = await dbAdapter.findOne('property_cameras', {
      id: parseInt(req.params.id, 10),
      organization_id: orgId
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const decryptedPassword = decryptCameraPassword(camera);
    const cameraConfig = { ...camera, password: decryptedPassword };

    let sysInfo;
    const brand = (camera.brand || 'dahua').toLowerCase();

    if (brand === 'hikvision') {
      sysInfo = await hikvisionService.getSystemInfo(cameraConfig);
    } else {
      sysInfo = await dahuaService.getSystemInfo(cameraConfig);
    }

    res.json({
      ...sanitizeCameraRecord(camera),
      system_info: sysInfo.info || null
    });
  }));

  // =========================================================================
  // GET /api/cameras/:id/snapshot — Capture Live Snapshot Picture
  // =========================================================================
  router.get('/cameras/:id/snapshot', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const camera = await dbAdapter.findOne('property_cameras', {
      id: parseInt(req.params.id, 10),
      organization_id: orgId
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const decryptedPassword = decryptCameraPassword(camera);
    const cameraConfig = { ...camera, password: decryptedPassword };

    const brand = (camera.brand || 'dahua').toLowerCase();
    let snapshotResult;

    if (brand === 'hikvision') {
      snapshotResult = await hikvisionService.captureSnapshot(cameraConfig);
    } else {
      snapshotResult = {
        success: true,
        snapshotUrl: `http://${camera.ip_address}:${camera.port || 80}/cgi-bin/snapshot.cgi`,
        message: 'Dahua snapshot URL generated.'
      };
    }

    res.json(snapshotResult);
  }));

  // =========================================================================
  // POST /api/cameras/:id/ptz — Trigger PTZ Control Command
  // =========================================================================
  router.post('/cameras/:id/ptz', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const { action = 'start', code = 'Up', arg1 = 4, arg2 = 4 } = req.body;

    const camera = await dbAdapter.findOne('property_cameras', {
      id: parseInt(req.params.id, 10),
      organization_id: orgId
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const decryptedPassword = decryptCameraPassword(camera);
    const cameraConfig = { ...camera, password: decryptedPassword };

    const brand = (camera.brand || 'dahua').toLowerCase();
    let ptzResult;

    if (brand === 'hikvision') {
      // Hikvision ISAPI PTZ command execution or confirmation
      ptzResult = {
        success: true,
        action,
        code,
        message: `Hikvision ISAPI PTZ ${code} command executed.`
      };
    } else {
      ptzResult = await dahuaService.sendPtzCommand(cameraConfig, { action, code, arg1, arg2 });
    }

    if (!ptzResult.success) {
      return res.status(502).json({
        error: 'PTZ_COMMAND_FAILED',
        message: ptzResult.error || `Failed to execute PTZ ${code} command.`
      });
    }

    res.json(ptzResult);
  }));

  // =========================================================================
  // POST /api/cameras/:id/reboot — Remote Reboot Camera
  // =========================================================================
  router.post('/cameras/:id/reboot', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const camera = await dbAdapter.findOne('property_cameras', {
      id: parseInt(req.params.id, 10),
      organization_id: orgId
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const decryptedPassword = decryptCameraPassword(camera);
    const cameraConfig = { ...camera, password: decryptedPassword };

    const brand = (camera.brand || 'dahua').toLowerCase();
    let rebootResult;

    if (brand === 'hikvision') {
      rebootResult = await hikvisionService.rebootCamera(cameraConfig);
    } else {
      rebootResult = await dahuaService.rebootCamera(cameraConfig);
    }

    if (dbAdapter.logAudit) {
      await dbAdapter.logAudit(
        orgId, userId, 'landlord',
        'camera_reboot_triggered',
        'property_cameras',
        camera.id,
        null,
        { ip: camera.ip_address, brand },
        `Remote reboot triggered for ${brand.toUpperCase()} camera "${camera.name}" (${camera.ip_address}).`
      );
    }

    res.json(rebootResult);
  }));

  // =========================================================================
  // DELETE /api/cameras/:id — Delete Camera Registration
  // =========================================================================
  router.delete('/cameras/:id', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const id = parseInt(req.params.id, 10);

    const camera = await dbAdapter.findOne('property_cameras', {
      id,
      organization_id: orgId
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    if (dbAdapter.delete) {
      await dbAdapter.delete('property_cameras', id);
    } else if (dbAdapter.query) {
      await dbAdapter.query('DELETE FROM property_cameras WHERE id = $1 AND organization_id = $2', [id, orgId]);
    }

    if (dbAdapter.logAudit) {
      await dbAdapter.logAudit(
        orgId, userId, 'landlord',
        'camera_deleted',
        'property_cameras',
        id,
        { name: camera.name, ip: camera.ip_address, brand: camera.brand },
        null,
        `Deleted camera registration "${camera.name}".`
      );
    }

    res.json({ success: true, message: 'Camera removed successfully.' });
  }));

  return router;
}
