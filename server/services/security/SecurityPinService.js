import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendEmailWithConfig } from '../../mailerService.js';
import { renderTemplate } from '../../emailTemplates.js';
import { normalizeSmtpConfig } from '../../emailConfigService.js';
import { decryptConfig } from '../../crypto.js';

let activeDb = null;

export function setSecurityPinDb(databaseInstance) {
  activeDb = databaseInstance;
}

function getDb() {
  if (!activeDb) {
    throw new Error('SecurityPinDb has not been set.');
  }
  return activeDb;
}

function isWeakPin(pin) {
  // Check for sequential digits like 1234, 123456, 0123, 9876
  const seq = '01234567890123456789';
  const revSeq = '98765432109876543210';
  if (seq.includes(pin) || revSeq.includes(pin)) return true;

  // Check for repeating digits like 0000, 1111, 222222
  const first = pin[0];
  if (pin.split('').every(c => c === first)) return true;

  return false;
}

function validatePinFormat(pin, confirmPin) {
  if (!pin || typeof pin !== 'string') {
    throw new Error('PIN_REQUIRED');
  }
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN_INVALID_FORMAT'); // Must be 4 to 6 digits, digits only
  }
  if (pin !== confirmPin) {
    throw new Error('PIN_MISMATCH');
  }
  if (isWeakPin(pin)) {
    throw new Error('PIN_TOO_WEAK');
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function getRequestIp(req) {
  if (!req) return '127.0.0.1';
  return (
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  ).split(',')[0].trim();
}

async function getRequestUserAgent(req) {
  if (!req) return 'Unknown';
  return String(req.headers['user-agent'] || '').slice(0, 500);
}

// Phase 3 required functions

export async function setupPin(userId, pin, confirmPin) {
  const db = getDb();
  validatePinFormat(pin, confirmPin);

  const existingPin = await db.findOne('security_pins', { user_id: Number(userId) });
  if (existingPin) {
    throw new Error('PIN_ALREADY_SET');
  }

  const membership = await db.findOne('organization_members', { user_id: Number(userId), role: 'landlord' });
  const orgId = membership ? membership.organization_id : null;

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(pin, salt);

  const pinRow = await db.insert('security_pins', {
    user_id: Number(userId),
    organization_id: orgId ? Number(orgId) : null,
    pin_hash: hash,
    pin_set_at: new Date().toISOString(),
    pin_updated_at: new Date().toISOString(),
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_last_verified_at: null,
    pin_reset_required: false
  });

  // Sync to organization if organization exists
  if (orgId) {
    await db.update('organizations', Number(orgId), { security_pin_hash: hash });
  }

  await db.logAudit(
    orgId ? Number(orgId) : null,
    Number(userId),
    'landlord',
    'pin_setup',
    'security_pin',
    pinRow.id,
    null,
    null,
    'Security PIN configured',
    'success'
  );

  return { success: true };
}

export async function verifyPin(userId, pin, context = {}) {
  const db = getDb();
  const pinRow = await db.findOne('security_pins', { user_id: Number(userId) });
  if (!pinRow) {
    throw new Error('PIN_NOT_SET');
  }

  if (pinRow.pin_locked_until && new Date(pinRow.pin_locked_until).getTime() > Date.now()) {
    throw new Error('PIN_LOCKED');
  }

  const isValid = bcrypt.compareSync(pin, pinRow.pin_hash);
  await recordPinAttempt(userId, isValid, context);

  if (!isValid) {
    throw new Error('INVALID_PIN');
  }

  return true;
}

export async function changePin(userId, currentPin, newPin, confirmPin) {
  const db = getDb();
  const pinRow = await db.findOne('security_pins', { user_id: Number(userId) });
  if (!pinRow) {
    throw new Error('PIN_NOT_SET');
  }

  // Verify current PIN first
  if (pinRow.pin_locked_until && new Date(pinRow.pin_locked_until).getTime() > Date.now()) {
    throw new Error('PIN_LOCKED');
  }

  const isCurrentValid = bcrypt.compareSync(currentPin, pinRow.pin_hash);
  if (!isCurrentValid) {
    await recordPinAttempt(userId, false, { action: 'pin_change_verify_failed' });
    throw new Error('INVALID_PIN');
  }

  // Validate new PIN
  validatePinFormat(newPin, confirmPin);

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPin, salt);

  await db.update('security_pins', pinRow.id, {
    pin_hash: hash,
    pin_updated_at: new Date().toISOString(),
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_reset_required: false
  });

  const orgId = pinRow.organization_id;
  if (orgId) {
    await db.update('organizations', Number(orgId), { security_pin_hash: hash });
  }

  await db.logAudit(
    orgId ? Number(orgId) : null,
    Number(userId),
    'landlord',
    'pin_changed',
    'security_pin',
    pinRow.id,
    null,
    null,
    'Security PIN changed successfully',
    'success'
  );

  return { success: true };
}

export async function requestPinReset(userEmail, req = null) {
  const db = getDb();
  const responseBody = { ok: true, success: true, message: 'If the email matches a registered account, reset instructions have been sent.' };
  let user = null;
  let pinRow = null;

  try {
    user = await db.findOne('users', { email: userEmail });
    if (!user || user.status === 'disabled') {
      return responseBody;
    }

    pinRow = await db.findOne('security_pins', { user_id: user.id });
    if (!pinRow) {
      // Landlord has no PIN configured yet
      return responseBody;
    }

    const platformSettings = await db.findOne('platform_billing_settings', { id: 1 });
    if (!platformSettings?.smtp_config_encrypted) {
      throw new Error('EMAIL_NOT_CONFIGURED');
    }

    if (process.env.DATA_BACKEND === 'postgres' && typeof db.query === 'function') {
      await db.query(
        `UPDATE security_pin_reset_tokens
            SET used_at = now()
          WHERE user_id = $1
            AND used_at IS NULL
            AND expires_at > now()`,
        [user.id]
      );
    } else {
      const nowIso = new Date().toISOString();
      const activeTokens = db.get('security_pin_reset_tokens').filter(row =>
        Number(row.user_id) === Number(user.id) &&
        !row.used_at &&
        new Date(row.expires_at).getTime() > Date.now()
      );
      for (const tokenRow of activeTokens) {
        db.update('security_pin_reset_tokens', tokenRow.id, { used_at: nowIso });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes expiry

    await db.insert('security_pin_reset_tokens', {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used_at: null,
      requested_ip: await getRequestIp(req),
      requested_user_agent: await getRequestUserAgent(req)
    });

    const credentials = normalizeSmtpConfig(decryptConfig(platformSettings.smtp_config_encrypted));
    const configuredProto = process.env.FRONTEND_URL || process.env.APP_PUBLIC_URL || 'https://smart-landlord-1e526.web.app';
    const cleanProto = configuredProto.replace(/\/+$/, '');
    const resetUrl = `${cleanProto}/reset-pin?token=${token}`;

    const { subject, html, text } = renderTemplate('security_pin_reset', {
      recipientName: user.name,
      resetUrl,
      expiryMinutes: 15
    });

    await sendEmailWithConfig(credentials, {
      to: userEmail,
      subject,
      html,
      text
    });

    await db.logAudit(
      pinRow.organization_id ? Number(pinRow.organization_id) : null,
      user.id,
      'landlord',
      'pin_reset_requested',
      'security_pin',
      pinRow.id,
      null,
      null,
      'Security PIN reset requested',
      'success'
    );

  } catch (error) {
    try {
      await db.logError(
        pinRow?.organization_id ? Number(pinRow.organization_id) : null,
        user?.id ? Number(user.id) : null,
        'security_pin_reset',
        'Security PIN reset request could not be completed internally.',
        null,
        { code: error.message }
      );
    } catch (_) {
      // Keep reset requests generic even if internal failure logging fails.
    }
    console.warn(`[security-pin-reset] Handled generically after error: ${error.message}`);
  }

  return responseBody;
}

export async function resetPinWithToken(token, newPin, confirmPin) {
  const db = getDb();
  if (!token) {
    throw new Error('RESET_TOKEN_INVALID');
  }

  const tokenHash = hashToken(token);
  const tokenRow = await db.findOne('security_pin_reset_tokens', { token_hash: tokenHash });

  if (!tokenRow || tokenRow.used_at) {
    throw new Error('RESET_TOKEN_INVALID');
  }

  const isExpired = new Date(tokenRow.expires_at).getTime() <= Date.now();
  if (isExpired) {
    throw new Error('RESET_TOKEN_EXPIRED');
  }

  validatePinFormat(newPin, confirmPin);

  const userId = Number(tokenRow.user_id);
  const pinRow = await db.findOne('security_pins', { user_id: userId });
  if (!pinRow) {
    throw new Error('PIN_NOT_SET');
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPin, salt);

  await db.update('security_pins', pinRow.id, {
    pin_hash: hash,
    pin_updated_at: new Date().toISOString(),
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_reset_required: false
  });

  // Mark token used
  if (process.env.DATA_BACKEND === 'postgres') {
    await db.query(
      `UPDATE security_pin_reset_tokens
          SET used_at = now()
        WHERE id = $1`,
      [tokenRow.id]
    );
  } else {
    db.update('security_pin_reset_tokens', tokenRow.id, { used_at: new Date().toISOString() });
  }

  const orgId = pinRow.organization_id;
  if (orgId) {
    await db.update('organizations', Number(orgId), { security_pin_hash: hash });
  }

  await db.logAudit(
    orgId ? Number(orgId) : null,
    userId,
    'landlord',
    'pin_reset_completed',
    'security_pin',
    pinRow.id,
    null,
    null,
    'Security PIN reset completed successfully',
    'success'
  );

  return { success: true };
}

export async function getPinStatus(userId) {
  const db = getDb();
  try {
    const pinRow = await db.findOne('security_pins', { user_id: Number(userId) });
    if (!pinRow) {
      return {
        pin_set: false,
        locked: false,
        locked_until: null,
        isSet: false,
        isLocked: false,
        lockedUntil: null
      };
    }

    const isLocked = pinRow.pin_locked_until && new Date(pinRow.pin_locked_until).getTime() > Date.now();

    return {
      pin_set: true,
      locked: !!isLocked,
      locked_until: pinRow.pin_locked_until,
      isSet: true,
      isLocked: !!isLocked,
      lockedUntil: pinRow.pin_locked_until,
      pinSetAt: pinRow.pin_set_at,
      pinUpdatedAt: pinRow.pin_updated_at,
      pinLastVerifiedAt: pinRow.pin_last_verified_at,
      pinResetRequired: pinRow.pin_reset_required
    };
  } catch (err) {
    if (err.message && (err.message.includes('security_pins') || err.message.includes('relation'))) {
      return {
        pin_set: false,
        locked: false,
        locked_until: null,
        isSet: false,
        isLocked: false,
        lockedUntil: null,
        error: 'Migration 029 is missing'
      };
    }
    throw err;
  }
}

export async function recordPinAttempt(userId, success, context = {}) {
  const db = getDb();
  const pinRow = await db.findOne('security_pins', { user_id: Number(userId) });
  if (!pinRow) return;

  const orgId = pinRow.organization_id;

  if (success) {
    await db.update('security_pins', pinRow.id, {
      pin_failed_attempts: 0,
      pin_locked_until: null,
      pin_last_verified_at: new Date().toISOString()
    });

    await db.logAudit(
      orgId ? Number(orgId) : null,
      Number(userId),
      'landlord',
      context.action || 'pin_verify_success',
      'security_pin',
      pinRow.id,
      null,
      null,
      `PIN verified successfully for action: ${context.action || 'verify'}`,
      'success'
    );
  } else {
    const attempts = pinRow.pin_failed_attempts + 1;
    let lockedUntil = pinRow.pin_locked_until;

    if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins lock
      await db.logAudit(
        orgId ? Number(orgId) : null,
        Number(userId),
        'landlord',
        'pin_locked',
        'security_pin',
        pinRow.id,
        null,
        null,
        'Security PIN locked due to too many failed attempts',
        'failed'
      );
    }

    await db.update('security_pins', pinRow.id, {
      pin_failed_attempts: attempts,
      pin_locked_until: lockedUntil
    });

    await db.logAudit(
      orgId ? Number(orgId) : null,
      Number(userId),
      'landlord',
      'pin_verify_failed',
      'security_pin',
      pinRow.id,
      null,
      null,
      `Failed PIN verification attempt ${attempts}`,
      'failed'
    );
  }
}

// Phase 3 required express middleware function
export function requireSecurityPin(actionName) {
  return async (req, res, next) => {
    const userId = req.auth?.userId;
    const orgId = req.auth?.organizationId;

    if (!userId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'A valid authenticated session is required.' });
    }

    const pin = req?.headers?.['x-security-pin'] || req?.body?.security_pin || req?.body?.pin;
    if (!pin) {
      return res.status(400).json({ error: 'PIN_REQUIRED', message: 'Security PIN is required for this action.' });
    }

    try {
      await verifyPin(userId, pin, { action: actionName, orgId, req });
      next();
    } catch (err) {
      if (err.message === 'PIN_LOCKED') {
        return res.status(423).json({ error: 'PIN_LOCKED', message: 'Security PIN is temporarily locked due to too many failed attempts.' });
      }
      if (err.message === 'INVALID_PIN') {
        return res.status(400).json({ error: 'INVALID_PIN', message: 'The Security PIN you entered is incorrect.' });
      }
      if (err.message === 'PIN_NOT_SET') {
        return res.status(400).json({ error: 'PIN_NOT_SET', message: 'Security PIN has not been set up yet.' });
      }
      return res.status(400).json({ error: err.message, message: err.message });
    }
  };
}
