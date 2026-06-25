import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// OTP Service — Smart Landlord V1.0
// ---------------------------------------------------------------------------
// Generates, stores, verifies, and expires 6-digit one-time passwords.
//
// Security properties:
//   - OTPs are generated with crypto.randomInt (cryptographically secure)
//   - OTPs are hashed with bcrypt (rounds=10) before database storage
//   - Plaintext OTP is only returned to the caller of requestOtp() once
//   - 10-minute hard expiry enforced at verification time
//   - Maximum 3 verification attempts per OTP (invalidated on 4th attempt)
//   - Maximum 5 OTP requests per identifier+context per 60-minute window
//   - Superseded OTPs are invalidated before issuing a new one
//
// Audit events emitted:
//   otp_requested  — new OTP created
//   otp_sent       — called externally after confirmed delivery
//   otp_verified   — successful verification
//   otp_failed     — wrong OTP submitted
//   otp_expired    — expiry detected at verification time, or attempt limit hit
// ---------------------------------------------------------------------------

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RATE_LIMIT_WINDOW_MINUTES = 60;
const OTP_RATE_LIMIT_MAX = 5;
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------
export class OtpError extends Error {
  /**
   * @param {string} code — machine-readable error code
   * @param {string} [message] — human-readable description
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'OtpError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Emit an audit log entry if pgDb supports it.
 * Failures here are non-fatal — we log a warning but do not throw.
 */
async function logAuditSafe(pgDb, orgId, userId, actionType, otpId, extra = {}) {
  if (!pgDb?.logAudit) return;

  try {
    await pgDb.logAudit(
      orgId,
      userId,
      'system',
      actionType,
      'otp_codes',
      otpId,
      null,
      { ...extra },
      `OTP event: ${actionType}`
    );
  } catch (err) {
    console.warn(`[otpService] Audit log failed (non-fatal): ${err.message}`);
  }
}

/**
 * Emit an error log entry if pgDb supports it.
 */
async function logErrorSafe(pgDb, orgId, userId, source, message) {
  if (!pgDb?.logError) return;

  try {
    await pgDb.logError(orgId, userId, source, message);
  } catch (_err) {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request a new OTP for a given identifier and context.
 *
 * Rate-limits to OTP_RATE_LIMIT_MAX requests per identifier+context per hour.
 * Invalidates any existing active (non-expired, non-verified) OTPs before
 * issuing the new one to prevent multiple valid codes coexisting.
 *
 * @param {object} opts
 * @param {object} opts.pgDb              — PostgreSQL db helper (must have .query, .insert, .update, .logAudit, .logError)
 * @param {string} opts.identifier        — email address or phone number
 * @param {string} opts.context           — purpose: 'email_verify' | 'password_reset' | 'phone_verify'
 * @param {number|null} [opts.organizationId] — owning org (null for platform-level)
 * @param {number|null} [opts.userId]         — linked user (null when not yet registered)
 *
 * @returns {Promise<{ otp: string, otpId: number, expiresAt: Date }>}
 * @throws {OtpError} RATE_LIMIT_EXCEEDED — if the hourly limit is hit
 */
export async function requestOtp({ pgDb, identifier, context, organizationId = null, userId = null }) {
  if (!pgDb) throw new Error('pgDb is required for OTP service.');
  if (!identifier || typeof identifier !== 'string') throw new Error('identifier is required.');
  if (!context || typeof context !== 'string') throw new Error('context is required.');

  const normalizedIdentifier = identifier.trim().toLowerCase();

  // 1. Rate-limit: count OTPs issued in the last OTP_RATE_LIMIT_WINDOW_MINUTES
  const windowStart = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
  const rateRes = await pgDb.query(
    `SELECT COUNT(*) AS cnt
       FROM otp_codes
      WHERE identifier = $1
        AND context    = $2
        AND created_at > $3`,
    [normalizedIdentifier, context, windowStart.toISOString()]
  );
  const recentCount = parseInt(rateRes.rows[0]?.cnt || '0', 10);

  if (recentCount >= OTP_RATE_LIMIT_MAX) {
    await logAuditSafe(pgDb, organizationId, userId, 'otp_rate_limited', null, {
      identifier: normalizedIdentifier,
      context,
      recent_count: recentCount
    });
    throw new OtpError(
      'RATE_LIMIT_EXCEEDED',
      `Too many OTP requests. Maximum ${OTP_RATE_LIMIT_MAX} per ${OTP_RATE_LIMIT_WINDOW_MINUTES} minutes.`
    );
  }

  // 2. Invalidate any existing active OTPs for this identifier+context
  await pgDb.query(
    `UPDATE otp_codes
        SET invalidated_at = now()
      WHERE identifier     = $1
        AND context        = $2
        AND verified_at   IS NULL
        AND invalidated_at IS NULL
        AND expires_at     > now()`,
    [normalizedIdentifier, context]
  );

  // 3. Generate secure 6-digit OTP
  const otpPlaintext = crypto.randomInt(100000, 1000000).toString();

  // 4. Hash OTP with bcrypt
  const otpHash = await bcrypt.hash(otpPlaintext, BCRYPT_ROUNDS);

  // 5. Persist the OTP record
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const row = await pgDb.insert('otp_codes', {
    organization_id: organizationId || null,
    user_id: userId || null,
    identifier: normalizedIdentifier,
    context,
    otp_hash: otpHash,
    expires_at: expiresAt.toISOString()
  });

  // 6. Audit log
  await logAuditSafe(pgDb, organizationId, userId, 'otp_requested', row.id, {
    identifier: normalizedIdentifier,
    context,
    expires_at: expiresAt.toISOString()
  });

  return {
    otp: otpPlaintext,   // caller must send this to the user immediately; it is not stored
    otpId: row.id,
    expiresAt
  };
}

/**
 * Record that an OTP was successfully sent to the user via an external channel.
 * Call this after confirming delivery (e.g. after nodemailer resolves).
 * This is separate from requestOtp to support fire-and-forget delivery.
 *
 * @param {object} opts
 * @param {object} opts.pgDb
 * @param {number} opts.otpId
 * @param {number|null} [opts.organizationId]
 * @param {number|null} [opts.userId]
 * @param {string} [opts.channel] — 'email' | 'sms'
 */
export async function recordOtpSent({ pgDb, otpId, organizationId = null, userId = null, channel = 'email' }) {
  if (!pgDb || !otpId) return;

  await logAuditSafe(pgDb, organizationId, userId, 'otp_sent', otpId, { channel });
}

/**
 * Verify a submitted OTP against the most recent active OTP for (identifier, context).
 *
 * Enforces:
 *   - Expiry (expires_at > now())
 *   - Single-use (verified_at IS NULL)
 *   - Not invalidated (invalidated_at IS NULL)
 *   - Max attempts (OTP_MAX_ATTEMPTS)
 *   - Correct hash (bcrypt compare)
 *
 * @param {object} opts
 * @param {object} opts.pgDb
 * @param {string} opts.identifier
 * @param {string} opts.context
 * @param {string} opts.otp             — the 6-digit OTP submitted by the user
 * @param {number|null} [opts.organizationId]
 * @param {number|null} [opts.userId]
 *
 * @returns {Promise<{ verified: true, otpId: number }>}
 * @throws {OtpError} OTP_NOT_FOUND_OR_EXPIRED | MAX_ATTEMPTS_EXCEEDED | OTP_INVALID
 */
export async function verifyOtp({ pgDb, identifier, context, otp, organizationId = null, userId = null }) {
  if (!pgDb) throw new Error('pgDb is required for OTP service.');
  if (!identifier || !context || !otp) throw new Error('identifier, context, and otp are required.');

  const normalizedIdentifier = identifier.trim().toLowerCase();

  // 1. Find the most recent active OTP for this identifier+context
  const findRes = await pgDb.query(
    `SELECT *
       FROM otp_codes
      WHERE identifier     = $1
        AND context        = $2
        AND verified_at   IS NULL
        AND invalidated_at IS NULL
        AND expires_at     > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedIdentifier, context]
  );

  const otpRow = findRes.rows[0];

  if (!otpRow) {
    await logAuditSafe(pgDb, organizationId, userId, 'otp_expired', null, {
      identifier: normalizedIdentifier,
      context,
      reason: 'not_found_or_expired'
    });
    throw new OtpError(
      'OTP_NOT_FOUND_OR_EXPIRED',
      'The OTP has expired or does not exist. Please request a new one.'
    );
  }

  // 2. Increment attempt counter before hash comparison
  const newAttempts = (otpRow.attempts || 0) + 1;
  await pgDb.query(
    'UPDATE otp_codes SET attempts = $1 WHERE id = $2',
    [newAttempts, otpRow.id]
  );

  // 3. Check attempt limit
  if (newAttempts > OTP_MAX_ATTEMPTS) {
    // Invalidate the OTP — too many attempts
    await pgDb.query(
      'UPDATE otp_codes SET invalidated_at = now() WHERE id = $1',
      [otpRow.id]
    );

    await logAuditSafe(pgDb, organizationId, userId, 'otp_expired', otpRow.id, {
      identifier: normalizedIdentifier,
      context,
      reason: 'max_attempts_exceeded',
      attempts: newAttempts
    });
    await logErrorSafe(
      pgDb, organizationId, userId,
      'otpService.verifyOtp',
      `OTP ${otpRow.id} for ${normalizedIdentifier}/${context} exceeded max attempts (${newAttempts}).`
    );

    throw new OtpError(
      'MAX_ATTEMPTS_EXCEEDED',
      `Too many incorrect attempts. The OTP has been invalidated. Please request a new one.`
    );
  }

  // 4. Compare submitted OTP against stored hash
  const isMatch = await bcrypt.compare(String(otp), otpRow.otp_hash);

  if (!isMatch) {
    const remaining = OTP_MAX_ATTEMPTS - newAttempts;

    await logAuditSafe(pgDb, organizationId, userId, 'otp_failed', otpRow.id, {
      identifier: normalizedIdentifier,
      context,
      attempts: newAttempts,
      remaining
    });

    throw new OtpError(
      'OTP_INVALID',
      `The OTP is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
    );
  }

  // 5. Mark as verified
  await pgDb.query(
    'UPDATE otp_codes SET verified_at = now() WHERE id = $1',
    [otpRow.id]
  );

  await logAuditSafe(pgDb, organizationId, userId, 'otp_verified', otpRow.id, {
    identifier: normalizedIdentifier,
    context
  });

  return { verified: true, otpId: otpRow.id };
}

/**
 * Explicitly invalidate all active OTPs for a given identifier+context.
 * Use this when the user cancels a flow or a new OTP supersedes all existing ones.
 *
 * @param {object} opts
 * @param {object} opts.pgDb
 * @param {string} opts.identifier
 * @param {string} opts.context
 */
export async function invalidatePendingOtps({ pgDb, identifier, context }) {
  if (!pgDb) return;

  const normalizedIdentifier = identifier.trim().toLowerCase();

  await pgDb.query(
    `UPDATE otp_codes
        SET invalidated_at = now()
      WHERE identifier     = $1
        AND context        = $2
        AND verified_at   IS NULL
        AND invalidated_at IS NULL`,
    [normalizedIdentifier, context]
  );
}
