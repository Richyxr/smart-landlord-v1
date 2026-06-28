import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import crypto from 'crypto';
import { db } from './db.js';
import { createPostgresDb } from './postgresDb.js';
import { createPropertyRoutes } from './routes/propertyRoutes.js';
import { createFinancialRoutes } from './routes/financialRoutes.js';
import { createReconciliationRoutes } from './routes/reconciliationRoutes.js';
import { createWebhookRoutes } from './routes/webhookRoutes.js';
import { createIntegrationRoutes } from './routes/integrationRoutes.js';
import { createNotificationRoutes } from './routes/notificationRoutes.js';
import { createSaasBillingRoutes } from './routes/saasBillingRoutes.js';
import { createPaymentEvidenceRoutes } from './routes/paymentEvidenceRoutes.js';
import { NotificationService } from './notificationService.js';
import { sendEmailWithConfig } from './mailerService.js';
import { EMAIL_MODES, maskSmtpConfig, normalizeSmtpConfig, prepareSmtpConfigForStorage, resolveEmailDeliveryConfig, validateSmtpConfig } from './emailConfigService.js';
import { maskSmsConfig, normalizeSmsConfig, prepareSmsConfigForStorage, validateSmsConfig } from './smsConfigService.js';
import {
  buildSmsReadinessChecklist,
  getSmsProviderProfile,
  listSmsProviderProfiles,
  normalizeProviderKey,
  normalizeKenyanPhoneNumber,
  sendSmsViaAdapter,
  validateSmsProviderConfig
} from './smsProviderService.js';
import {
  getPlatformSmsPricingSettings,
  logSmsSystemError,
  recordSmsUsageLedger,
  validateSmsPricingInput
} from './smsUsageLedgerService.js';
import { decryptConfig, encryptConfig } from './crypto.js';
import { renderTemplate } from './emailTemplates.js';
import { invalidatePendingOtps, recordOtpSent, requestOtp, verifyOtp, OtpError } from './otpService.js';
import { generateOrganizationAccountNumber } from './organizationAccountNumbers.js';
import { initializeApp as initializeFirebaseAdminApp, getApps as getFirebaseAdminApps } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';

const app = express();
const PORT = process.env.PORT || 5000;
const IS_APP_HOSTING =
  Boolean(process.env.K_SERVICE) ||
  Boolean(process.env.GAE_SERVICE) ||
  Boolean(process.env.FIREBASE_CONFIG);

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  process.env.APP_ENV === 'production' ||
  IS_APP_HOSTING;

const DATA_BACKEND = process.env.DATA_BACKEND || (IS_PRODUCTION ? 'postgres' : 'json');
const DEMO_MODE = process.env.DEMO_MODE === 'true' || (!IS_PRODUCTION && process.env.DEMO_MODE !== 'false');

if (IS_PRODUCTION) {
  if (process.env.DEMO_MODE === 'true') {
    throw new Error('Refusing to start production with DEMO_MODE=true.');
  }

  if (DATA_BACKEND !== 'postgres') {
    throw new Error('Refusing to start production without DATA_BACKEND=postgres.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Refusing to start production without DATABASE_URL. Configure a persistent PostgreSQL database.');
  }
}

const pgDb = DATA_BACKEND === 'postgres' ? createPostgresDb() : null;
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? null : 'smart-landlord-dev-session-secret');
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10);
const CARETAKER_PIN_PATTERN = /^\d{6}$/;
const CARETAKER_MAX_FAILED_LOGIN_ATTEMPTS = 3;
const CARETAKER_LOCKOUT_MS = 15 * 60 * 1000;
const CARETAKER_LOGIN_ERROR = 'Invalid phone number or PIN.';
const REGISTRATION_OTP_CONTEXT = 'registration_email_verify';
const REGISTRATION_SMOKE_HEADER = 'x-smart-landlord-registration-smoke';
const PASSWORD_RESET_EXPIRY_MINUTES = 60;
const PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES = 60;
const PASSWORD_RESET_RATE_LIMIT_MAX = 5;
const PASSWORD_RESET_GENERIC_MESSAGE = 'If this email exists, we have sent password reset instructions.';
const PASSWORD_RESET_INVALID_MESSAGE = 'Password reset link is invalid or expired. Please request a new one.';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'smart-landlord-1e526';
const firebaseAdminApp = getFirebaseAdminApps().length
  ? getFirebaseAdminApps()[0]
  : initializeFirebaseAdminApp({ projectId: FIREBASE_PROJECT_ID });
const firebaseAdminAuth = process.env.NODE_ENV === 'test'
  ? (() => {
      global.mockFirebasePasswords = global.mockFirebasePasswords || {
        'smoke:reset-test@example.com': 'OldPassword123!'
      };
      return {
        getUser: async (uid) => ({
          uid,
          providerData: [{ providerId: 'password' }],
          email: uid.startsWith('smoke:') ? uid.slice(6) : uid
        }),
        verifyIdToken: async (idToken) => ({
          uid: idToken,
          email: idToken.startsWith('smoke:') ? idToken.slice(6) : idToken
        }),
        updateUser: async (uid, properties) => {
          if (properties.password) {
            global.mockFirebasePasswords[uid] = properties.password;
          }
          return { uid };
        },
        revokeRefreshTokens: async (uid) => ({ uid })
      };
    })()
  : getFirebaseAdminAuth(firebaseAdminApp);

const publicApiPaths = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/firebase-profile',
  '/api/auth/registration/start',
  '/api/auth/registration/resend-otp',
  '/api/auth/registration/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/caretaker/login',
  '/api/webhooks/payment',
  '/api/webhooks/mpesa/c2b',
  '/api/webhooks/mpesa/stk',
  '/api/webhooks/bank'
]);

if (process.env.NODE_ENV === 'test') {
  publicApiPaths.add('/api/test/auth/mock-firebase-login');
}

app.use(cors());
app.use(express.json());

// Set up file uploads for CSV statements
const upload = multer({ dest: 'uploads/' });

function requireDemoMode(req, res, next) {
  if (!DEMO_MODE) {
    return res.status(503).json({
      error: 'DEMO_ENDPOINT_DISABLED',
      message: 'This endpoint is available only when DEMO_MODE=true. Configure production authentication before enabling live access.'
    });
  }
  next();
}

function getRequestRole(req) {
  return req.auth?.role || null;
}

function requireAuthenticated(req, res, next) {
  if (req.auth) {
    return next();
  }

  return res.status(401).json({
    error: 'AUTH_REQUIRED',
    message: 'A valid authenticated session is required.'
  });
}

function requireAnyRole(...allowedRoles) {
  return (req, res, next) => {
    const role = getRequestRole(req);
    if (role && allowedRoles.includes(role)) {
      return next();
    }

    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'You do not have permission to access this feature.'
    });
  };
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload) {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required outside demo development mode.');
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!SESSION_SECRET || !token || !token.includes('.')) return null;

  const [encodedPayload, signature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.expires_at && Date.now() > payload.expires_at) {
      return null;
    }

    return payload;
  } catch (_error) {
    return null;
  }
}

function createSessionToken(user, role, organization) {
  return signPayload({
    user_id: user.id,
    role,
    organization_id: organization ? organization.id : null,
    issued_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL_SECONDS * 1000
  });
}

async function activeFindOne(table, filterObj) {
  return pgDb ? pgDb.findOne(table, filterObj) : db.findOne(table, filterObj);
}

async function activeInsert(table, data) {
  return pgDb ? pgDb.insert(table, data) : db.insert(table, data);
}

async function activeUpdate(table, idOrFilter, data) {
  return pgDb ? pgDb.update(table, idOrFilter, data) : db.update(table, idOrFilter, data);
}

function nextJsonOrganizationAccountNumber() {
  return pgDb ? undefined : generateOrganizationAccountNumber(db.get('organizations'));
}

function cleanAndNormalizePhoneNumber(phone, country = 'Kenya') {
  if (!phone) {
    throw new Error('Phone number is required.');
  }
  let cleaned = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (country === 'Kenya') {
    if (cleaned.startsWith('+254')) {
      if (/^\+254[71]\d{8}$/.test(cleaned)) return cleaned;
      throw new Error('Invalid Kenyan phone number format. Expected +2547XXXXXXXX or +2541XXXXXXXX.');
    }
    if (cleaned.startsWith('254')) {
      const formatted = '+' + cleaned;
      if (/^\+254[71]\d{8}$/.test(formatted)) return formatted;
      throw new Error('Invalid Kenyan phone number format. Expected 2547XXXXXXXX or 2541XXXXXXXX.');
    }
    if ((cleaned.startsWith('07') || cleaned.startsWith('01')) && cleaned.length === 10) {
      return '+254' + cleaned.slice(1);
    }
    if ((cleaned.startsWith('7') || cleaned.startsWith('1')) && cleaned.length === 9) {
      return '+254' + cleaned;
    }
    throw new Error('Invalid Kenyan phone number format. Expected 07XXXXXXXX, 01XXXXXXXX, or +2547XXXXXXXX.');
  } else if (country === 'Uganda') {
    if (cleaned.startsWith('+256')) {
      if (/^\+256\d{9}$/.test(cleaned)) return cleaned;
      throw new Error('Invalid Uganda phone number format.');
    }
    if (cleaned.startsWith('256')) {
      const formatted = '+' + cleaned;
      if (/^\+256\d{9}$/.test(formatted)) return formatted;
      throw new Error('Invalid Uganda phone number format.');
    }
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return '+256' + cleaned.slice(1);
    }
    if (cleaned.length === 9) {
      return '+256' + cleaned;
    }
    throw new Error('Invalid Uganda phone number format.');
  } else if (country === 'Tanzania') {
    if (cleaned.startsWith('+255')) {
      if (/^\+255\d{9}$/.test(cleaned)) return cleaned;
      throw new Error('Invalid Tanzania phone number format.');
    }
    if (cleaned.startsWith('255')) {
      const formatted = '+' + cleaned;
      if (/^\+255\d{9}$/.test(formatted)) return formatted;
      throw new Error('Invalid Tanzania phone number format.');
    }
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return '+255' + cleaned.slice(1);
    }
    if (cleaned.length === 9) {
      return '+255' + cleaned;
    }
    throw new Error('Invalid Tanzania phone number format.');
  }
  if (/^\+\d{10,15}$/.test(cleaned)) {
    return cleaned;
  }
  throw new Error('Invalid phone number format.');
}

function splitFirstName(name) {
  if (!name) return '';
  return name.split(' ')[0] || '';
}

function splitLastName(name) {
  if (!name) return '';
  const parts = name.split(' ');
  return parts.slice(1).join(' ') || '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function validatePasswordStrength(password) {
  if (!password || String(password).length < 6) {
    return 'Password must be at least 6 characters.';
  }

  return null;
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getRequestIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || null;
}

function getFrontendBaseUrl(req) {
  const configured = process.env.FRONTEND_URL || process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = req.get('host');
  return host ? `${protocol}://${host}` : 'https://smart-landlord-1e526.web.app';
}

function buildPasswordResetUrl(req, token) {
  const url = new URL('/reset-password', getFrontendBaseUrl(req));
  url.searchParams.set('token', token);
  return url.toString();
}

async function resolvePlatformEmailCredentials(activeDb) {
  const platformSettings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  if (!platformSettings?.smtp_config_encrypted) {
    const error = new Error('Email delivery is not configured.');
    error.code = 'EMAIL_CONFIGURATION_NOT_READY';
    throw error;
  }

  const credentials = normalizeSmtpConfig(decryptConfig(platformSettings.smtp_config_encrypted));
  const missing = validateSmtpConfig(credentials);
  if (missing.length > 0 || !['verified', 'active'].includes(platformSettings.smtp_status || '')) {
    const error = new Error('Email delivery is not configured.');
    error.code = 'EMAIL_CONFIGURATION_NOT_READY';
    throw error;
  }

  return credentials;
}

async function getFirebasePasswordUser(user) {
  if (!user?.auth_provider_uid) return null;

  try {
    const firebaseUser = await firebaseAdminAuth.getUser(user.auth_provider_uid);
    const hasPasswordProvider = firebaseUser.providerData?.some(provider => provider.providerId === 'password');
    return hasPasswordProvider ? firebaseUser : null;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      console.warn(`[password-reset] Firebase lookup skipped for user ${user.id}: ${error.message}`);
    }
    return null;
  }
}

async function countRecentPasswordResetRequests(userId) {
  const windowStart = new Date(Date.now() - PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  if (pgDb) {
    const result = await pgDb.query(
      `SELECT COUNT(*) AS cnt
         FROM password_reset_tokens
        WHERE user_id = $1
          AND created_at > $2`,
      [userId, windowStart.toISOString()]
    );
    return Number.parseInt(result.rows[0]?.cnt || '0', 10);
  }

  return db.get('password_reset_tokens').filter(row =>
    Number(row.user_id) === Number(userId) &&
    new Date(row.created_at).getTime() > windowStart.getTime()
  ).length;
}

async function invalidateActivePasswordResetTokens(userId) {
  if (pgDb) {
    await pgDb.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE user_id = $1
          AND used_at IS NULL
          AND expires_at > now()`,
      [userId]
    );
    return;
  }

  const nowIso = new Date().toISOString();
  const activeRows = db.get('password_reset_tokens').filter(row =>
    Number(row.user_id) === Number(userId) &&
    !row.used_at &&
    new Date(row.expires_at).getTime() > Date.now()
  );

  for (const row of activeRows) {
    db.update('password_reset_tokens', row.id, { used_at: nowIso });
  }
}

async function findPasswordResetToken(tokenHash) {
  return pgDb
    ? pgDb.findOne('password_reset_tokens', { token_hash: tokenHash })
    : db.findOne('password_reset_tokens', { token_hash: tokenHash });
}

async function markPasswordResetTokenUsed(tokenId) {
  if (pgDb) {
    const result = await pgDb.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE id = $1
          AND used_at IS NULL
        RETURNING *`,
      [tokenId]
    );
    return result.rows[0] || null;
  }

  const token = db.findOne('password_reset_tokens', { id: Number(tokenId) });
  if (!token || token.used_at) return null;
  return db.update('password_reset_tokens', Number(tokenId), { used_at: new Date().toISOString() })[0] || null;
}

function createJsonOtpDb() {
  return {
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalizedSql.startsWith('select count(*) as cnt from otp_codes')) {
        const [identifier, context, createdAfter] = params;
        const createdAfterTime = new Date(createdAfter).getTime();
        const count = db.get('otp_codes').filter(row =>
          row.identifier === identifier &&
          row.context === context &&
          new Date(row.created_at).getTime() > createdAfterTime
        ).length;
        return { rows: [{ cnt: String(count) }] };
      }

      if (normalizedSql.startsWith('update otp_codes set invalidated_at = now() where identifier')) {
        const [identifier, context] = params;
        const nowIso = new Date().toISOString();
        const activeRows = db.get('otp_codes').filter(row =>
          row.identifier === identifier &&
          row.context === context &&
          !row.verified_at &&
          !row.invalidated_at &&
          new Date(row.expires_at).getTime() > Date.now()
        );
        for (const row of activeRows) {
          db.update('otp_codes', row.id, { invalidated_at: nowIso });
        }
        return { rows: [] };
      }

      if (normalizedSql.startsWith('select * from otp_codes where identifier')) {
        const [identifier, context] = params;
        const rows = db.get('otp_codes')
          .filter(row =>
            row.identifier === identifier &&
            row.context === context &&
            !row.verified_at &&
            !row.invalidated_at &&
            new Date(row.expires_at).getTime() > Date.now()
          )
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows: rows.slice(0, 1) };
      }

      if (normalizedSql.startsWith('update otp_codes set attempts =')) {
        const [attempts, id] = params;
        db.update('otp_codes', Number(id), { attempts });
        return { rows: [] };
      }

      if (normalizedSql.startsWith('update otp_codes set invalidated_at = now() where id')) {
        const [id] = params;
        db.update('otp_codes', Number(id), { invalidated_at: new Date().toISOString() });
        return { rows: [] };
      }

      if (normalizedSql.startsWith('update otp_codes set verified_at = now() where id')) {
        const [id] = params;
        db.update('otp_codes', Number(id), { verified_at: new Date().toISOString() });
        return { rows: [] };
      }

      throw new Error(`Unsupported JSON OTP query: ${sql}`);
    },

    async insert(table, rowData) {
      return db.insert(table, rowData);
    },

    async update(table, query, updates) {
      return db.update(table, query, updates);
    },

    async logAudit(orgId, actorUserId, actorRole, actionType, targetType, targetId, oldValues = null, newValues = null, reason = '', pinValidated = null) {
      return db.logAudit(orgId, actorUserId, actorRole, actionType, targetType, targetId, oldValues, newValues, reason, pinValidated);
    },

    async logError(orgId, userId, source, message) {
      return db.logError(orgId, userId, source, message);
    }
  };
}

const jsonOtpDb = pgDb ? null : createJsonOtpDb();

function getOtpDb() {
  return pgDb || jsonOtpDb;
}

async function logRegistrationAudit(orgId, userId, actionType, reason, status = null, newValues = null) {
  const activeDb = pgDb || db;
  if (!activeDb?.logAudit) return;

  try {
    await activeDb.logAudit(
      orgId || null,
      userId || null,
      'system',
      actionType,
      'registration',
      userId || null,
      null,
      newValues,
      reason,
      status
    );
  } catch (error) {
    console.warn(`[registration] Audit log failed (non-fatal): ${error.message}`);
  }
}

async function verifyFirebaseOrSmokeRegistrationToken(req) {
  if (DEMO_MODE && req.headers[REGISTRATION_SMOKE_HEADER] === 'true') {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    if (!email) {
      const error = new Error('EMAIL_REQUIRED');
      error.statusCode = 400;
      throw error;
    }
    return {
      uid: body.firebase_uid || `smoke:${email}`,
      email,
      email_verified: body.email_verified !== undefined ? Boolean(body.email_verified) : false,
      name: body.name || email.split('@')[0],
      phone_number: body.phone_number || ''
    };
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    const error = new Error('FIREBASE_TOKEN_REQUIRED');
    error.statusCode = 401;
    throw error;
  }

  const decodedToken = await firebaseAdminAuth.verifyIdToken(idToken);
  return decodedToken;
}

async function ensureRegistrationProfile(decodedToken, profile = {}) {
  const firebaseUid = decodedToken.uid;
  const email = normalizeEmail(decodedToken.email || profile.email);

  if (!firebaseUid || !email) {
    const error = new Error('REGISTRATION_PROFILE_INVALID');
    error.statusCode = 400;
    throw error;
  }

  const displayName = profile.name || decodedToken.name || email.split('@')[0];
  const phoneNumber = profile.phone_number || decodedToken.phone_number || '';

  let user = await activeFindOne('users', { auth_provider_uid: firebaseUid });
  if (!user) {
    user = await activeFindOne('users', { email });
  }

  if (user?.email_verified && user.status === 'active') {
    const error = new Error('ACCOUNT_ALREADY_ACTIVE');
    error.statusCode = 409;
    throw error;
  }

  if (user?.auth_provider_uid && user.auth_provider_uid !== firebaseUid) {
    const error = new Error('REGISTRATION_UNAVAILABLE');
    error.statusCode = 409;
    throw error;
  }

  let normalizedPhone;
  try {
    normalizedPhone = cleanAndNormalizePhoneNumber(phoneNumber || profile.phone_number, profile.country || 'Kenya');
  } catch (err) {
    normalizedPhone = phoneNumber || profile.phone_number;
  }

  const isCompany = profile.type === 'company';
  const first_name = isCompany ? profile.representative_first_name : profile.first_name;
  const last_name = isCompany ? profile.representative_last_name : profile.last_name;
  const resolvedName = (first_name && last_name) ? `${first_name} ${last_name}` : displayName;

  if (!user) {
    user = await activeInsert('users', {
      auth_provider_uid: firebaseUid,
      email,
      email_verified: false,
      phone_number: normalizedPhone,
      phone_verified: Boolean(decodedToken.phone_number),
      name: resolvedName,
      first_name: first_name || splitFirstName(displayName),
      last_name: last_name || splitLastName(displayName),
      status: 'pending_verification'
    });
  } else {
    await activeUpdate('users', user.id, {
      auth_provider_uid: user.auth_provider_uid || firebaseUid,
      email,
      email_verified: false,
      phone_number: normalizedPhone || user.phone_number,
      name: resolvedName || user.name,
      first_name: first_name || user.first_name || splitFirstName(user.name),
      last_name: last_name || user.last_name || splitLastName(user.name),
      status: 'pending_verification'
    });
    user = await activeFindOne('users', { id: user.id });
  }

  let membership = await activeFindOne('organization_members', {
    user_id: user.id,
    role: 'landlord'
  });

  let organization = membership?.organization_id
    ? await activeFindOne('organizations', { id: membership.organization_id })
    : null;

  if (!organization) {
    let normRepPhone;
    if (isCompany && profile.representative_phone_e164) {
      try {
        normRepPhone = cleanAndNormalizePhoneNumber(profile.representative_phone_e164, profile.country || 'Kenya');
      } catch (err) {
        normRepPhone = profile.representative_phone_e164;
      }
    }

    organization = await activeInsert('organizations', {
      owner_user_id: user.id,
      account_number: nextJsonOrganizationAccountNumber(),
      name: isCompany ? (profile.company_name || resolvedName) : resolvedName,
      type: profile.type || 'individual',
      registration_number: profile.registration_number || '',
      tax_identifier: profile.tax_identifier || '',
      email,
      phone_number: normalizedPhone,
      country: profile.country || 'Kenya',
      billing_currency: profile.billing_currency || 'KES',
      email_delivery_mode: EMAIL_MODES.PLATFORM,
      subscription_tier: 'standard',
      subscription_status: 'trial',
      trial_start_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      subscription_expires_at: null,
      is_locked: false,
      security_pin_hash: '',
      status: 'active',
      representative_first_name: profile.representative_first_name || '',
      representative_last_name: profile.representative_last_name || '',
      representative_role: profile.representative_role || '',
      representative_phone_e164: normRepPhone || '',
      representative_email: profile.representative_email || '',
      representative_authorized: Boolean(profile.representative_authorized),
      profile_completed: Boolean(profile.profile_confirmed),
      profile_confirmed_at: profile.profile_confirmed ? new Date().toISOString() : null,
      kyc_status: profile.profile_confirmed ? 'completed' : 'incomplete'
    });

    membership = await activeInsert('organization_members', {
      organization_id: organization.id,
      user_id: user.id,
      role: 'landlord',
      status: 'active'
    });

    await activeInsert('notification_settings', {
      organization_id: organization.id,
      rent_reminders_enabled: true,
      reminder_days_before_due: 3,
      payment_confirmation_enabled: true,
      unmatched_payment_alert_enabled: true,
      meter_reading_alert_enabled: true,
      billing_alerts_enabled: true,
      sms_provider: 'None'
    });
  }

  return { user, organization, membership };
}

async function sendRegistrationOtpEmail({ user, organization }) {
  const otpDb = getOtpDb();
  const normalizedEmail = normalizeEmail(user.email);

  const otpRequest = await requestOtp({
    pgDb: otpDb,
    identifier: normalizedEmail,
    context: REGISTRATION_OTP_CONTEXT,
    organizationId: organization?.id || null,
    userId: user.id
  });

  await logRegistrationAudit(
    organization?.id,
    user.id,
    'registration_otp_requested',
    'Registration email OTP requested.',
    null,
    { email: normalizedEmail, context: REGISTRATION_OTP_CONTEXT }
  );

  const { subject, html, text } = renderTemplate('otp_verification', {
    otp: otpRequest.otp,
    context: 'email_verify',
    recipientName: user.name,
    expiryMinutes: 10
  });

  try {
    const delivery = await resolveEmailDeliveryConfig({
      pgDb: (pgDb || db),
      organizationId: organization?.id
    });

    await sendEmailWithConfig(delivery.credentials, {
      to: normalizedEmail,
      subject,
      html,
      text
    });
  } catch (error) {
    await invalidatePendingOtps({
      pgDb: otpDb,
      identifier: normalizedEmail,
      context: REGISTRATION_OTP_CONTEXT
    });
    throw error;
  }

  await recordOtpSent({
    pgDb: otpDb,
    otpId: otpRequest.otpId,
    organizationId: organization?.id || null,
    userId: user.id,
    channel: 'email'
  });

  await logRegistrationAudit(
    organization?.id,
    user.id,
    'registration_otp_sent',
    'Registration email OTP sent.',
    'success',
    { email: normalizedEmail, context: REGISTRATION_OTP_CONTEXT }
  );

  return { expiresAt: otpRequest.expiresAt };
}

function mapOtpErrorToResponse(error) {
  if (error instanceof OtpError && error.code === 'RATE_LIMIT_EXCEEDED') {
    return {
      status: 429,
      body: {
        error: 'REGISTRATION_OTP_RATE_LIMITED',
        message: 'Too many verification code requests. Please wait before requesting another code.'
      }
    };
  }

  return {
    status: 400,
    body: {
      error: 'REGISTRATION_OTP_INVALID',
      message: 'The verification code is invalid or expired. Please request a new code if needed.'
    }
  };
}

function isValidCaretakerPin(pin) {
  return CARETAKER_PIN_PATTERN.test(String(pin || ''));
}

function generateCaretakerPin() {
  const pin = crypto.randomInt(100000, 1000000).toString();
  if (!isValidCaretakerPin(pin)) {
    throw new Error('Generated caretaker PIN did not meet the 6-digit numeric requirement.');
  }
  return pin;
}

function getCaretakerLockedUntil(user) {
  if (!user?.caretaker_locked_until) return null;
  const lockedUntil = new Date(user.caretaker_locked_until);
  return Number.isNaN(lockedUntil.getTime()) ? null : lockedUntil;
}

async function findCaretakerMembership(userId) {
  const memberships = pgDb
    ? await pgDb.find('organization_members', { user_id: userId, role: 'caretaker' })
    : db.find('organization_members', { user_id: userId, role: 'caretaker' });
  return memberships.find(member => member.status === 'active') || memberships[0] || null;
}

async function logCaretakerAuditSafe(organizationId, userId, actionType, reason, status = null) {
  const activeDb = pgDb || db;
  if (!activeDb?.logAudit) return;

  try {
    await activeDb.logAudit(
      organizationId || null,
      userId || null,
      'caretaker',
      actionType,
      'user',
      userId || null,
      null,
      null,
      reason,
      status
    );
  } catch (error) {
    console.warn(`[caretaker-auth] Audit log failed (non-fatal): ${error.message}`);
  }
}

async function resetCaretakerLoginState(userId) {
  await activeUpdate('users', userId, {
    caretaker_failed_login_attempts: 0,
    caretaker_locked_until: null,
    caretaker_last_failed_login_at: null
  });
}

async function recordCaretakerLoginFailure(user, membership, reason) {
  if (!user) return;
  if (!user.caretaker_pin_hash && !membership) return;

  const failedAttempts = Number(user.caretaker_failed_login_attempts || 0) + 1;
  const lockNow = failedAttempts >= CARETAKER_MAX_FAILED_LOGIN_ATTEMPTS;
  const lockedUntil = lockNow ? new Date(Date.now() + CARETAKER_LOCKOUT_MS).toISOString() : null;

  await activeUpdate('users', user.id, {
    caretaker_failed_login_attempts: failedAttempts,
    caretaker_last_failed_login_at: new Date().toISOString(),
    caretaker_locked_until: lockedUntil
  });

  await logCaretakerAuditSafe(
    membership?.organization_id,
    user.id,
    lockNow ? 'caretaker_login_locked' : 'caretaker_login_failed',
    lockNow ? 'Caretaker login locked after repeated failed attempts.' : `Caretaker login failed: ${reason}.`,
    'failed'
  );
}

async function attachSessionContext(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const session = verifyToken(token);
      if (!session) {
        // /api/auth/firebase-profile receives Firebase ID tokens, not legacy Smart Landlord session tokens.
        // Let the route handler verify Firebase tokens with firebase-admin.
        if (req.path === '/api/auth/firebase-profile' || req.path.startsWith('/api/auth/registration/')) {
          return next();
        }

        return res.status(401).json({ error: 'INVALID_SESSION', message: 'Session is invalid or expired.' });
      }

      const user = await activeFindOne('users', { id: session.user_id });
      const organization = session.organization_id
        ? await activeFindOne('organizations', { id: session.organization_id })
        : null;

      if (!user || (session.organization_id && !organization)) {
        return res.status(401).json({ error: 'INVALID_SESSION', message: 'Session user or organization no longer exists.' });
      }

      if (session.role === 'landlord' && (user.status === 'pending_verification' || user.email_verified === false)) {
        return res.status(403).json({
          error: 'EMAIL_VERIFICATION_REQUIRED',
          message: 'Please verify your email address before continuing.'
        });
      }

      req.auth = {
        user,
        organization,
        role: session.role,
        userId: user.id,
        organizationId: organization ? organization.id : null
      };
    }

    if (IS_PRODUCTION && req.path.startsWith('/api') && !publicApiPaths.has(req.path) && !req.auth) {
      return res.status(401).json({
        error: 'AUTH_REQUIRED',
        message: 'A valid authenticated session is required.'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

// Helper for Organization Billing / Lockout check
async function checkOrganizationLock(req, res, next) {
  try {
    const orgId = req.auth?.organizationId;
    if (orgId) {
      const activeDb = pgDb || db;
      let org = await activeDb.findOne('organizations', { id: orgId });
      if (org) {
        let needsUpdate = false;
        let subscriptionStatus = org.subscription_status;
        let isLocked = org.is_locked;

        if (org.subscription_status === 'trial' && org.trial_ends_at && Date.now() > new Date(org.trial_ends_at).getTime()) {
          subscriptionStatus = 'overdue';
          isLocked = true;
          needsUpdate = true;
        } else if (org.subscription_status === 'active' && org.subscription_expires_at && Date.now() > new Date(org.subscription_expires_at).getTime()) {
          subscriptionStatus = 'overdue';
          isLocked = true;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await activeDb.update('organizations', org.id, {
            subscription_status: subscriptionStatus,
            is_locked: isLocked
          });
          org = await activeDb.findOne('organizations', { id: orgId });
        }

        // Demo/MVP deployments should not lock newly registered landlord accounts.
        // Real SaaS lock enforcement should be re-enabled only after billing/payment flows are production-ready.
        if ((!DEMO_MODE || org.subscription_status === 'overdue') && org.is_locked && !req.path.startsWith('/api/saas') && !req.path.startsWith('/api/admin')) {
          return res.status(403).json({
            error: 'LOCKED',
            message: 'Your account is temporarily locked due to an overdue platform invoice. Please complete payment to restore access.'
          });
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

app.use(attachSessionContext);
app.use(checkOrganizationLock);

// --- REGISTRATION EMAIL OTP API ---
app.post('/api/auth/forgot-password', async (req, res) => {
  const responseBody = { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };

  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) {
      return res.json(responseBody);
    }

    const activeDb = pgDb || db;
    const user = await activeFindOne('users', { email });
    if (!user || user.status === 'disabled') {
      return res.json(responseBody);
    }

    const firebaseUser = await getFirebasePasswordUser(user);
    if (!firebaseUser) {
      return res.json(responseBody);
    }

    const recentCount = await countRecentPasswordResetRequests(user.id);
    if (recentCount >= PASSWORD_RESET_RATE_LIMIT_MAX) {
      return res.json(responseBody);
    }

    await invalidateActivePasswordResetTokens(user.id);

    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);
    const resetTokenRow = await activeInsert('password_reset_tokens', {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      used_at: null,
      requested_ip: getRequestIp(req),
      requested_user_agent: String(req.headers['user-agent'] || '').slice(0, 500)
    });

    try {
      const credentials = await resolvePlatformEmailCredentials(activeDb);
      const { subject, html, text } = renderTemplate('password_reset', {
        recipientName: user.name,
        resetUrl: buildPasswordResetUrl(req, token),
        expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES
      });

      await sendEmailWithConfig(credentials, {
        to: email,
        subject,
        html,
        text
      });
    } catch (error) {
      await markPasswordResetTokenUsed(resetTokenRow.id);
      console.warn(`[password-reset] Reset email was not sent for user ${user.id}: ${error.message}`);
    }

    return res.json(responseBody);
  } catch (error) {
    console.warn(`[password-reset] Forgot-password request handled generically after error: ${error.message}`);
    return res.json(responseBody);
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || req.body?.password || '');
    const confirmPassword = req.body?.confirm_password !== undefined
      ? String(req.body.confirm_password || '')
      : newPassword;

    if (!token) {
      return res.status(400).json({
        error: 'PASSWORD_RESET_INVALID',
        message: PASSWORD_RESET_INVALID_MESSAGE
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'PASSWORD_RESET_PASSWORD_MISMATCH',
        message: 'Passwords do not match.'
      });
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return res.status(400).json({
        error: 'PASSWORD_RESET_WEAK_PASSWORD',
        message: passwordError
      });
    }

    const tokenHash = hashPasswordResetToken(token);
    const tokenRow = await findPasswordResetToken(tokenHash);
    const isExpired = !tokenRow?.expires_at || new Date(tokenRow.expires_at).getTime() <= Date.now();

    if (!tokenRow || tokenRow.used_at || isExpired) {
      return res.status(400).json({
        error: 'PASSWORD_RESET_INVALID',
        message: PASSWORD_RESET_INVALID_MESSAGE
      });
    }

    const user = await activeFindOne('users', { id: Number(tokenRow.user_id) });
    const firebaseUser = await getFirebasePasswordUser(user);
    if (!user || user.status === 'disabled' || !firebaseUser) {
      await markPasswordResetTokenUsed(tokenRow.id);
      return res.status(400).json({
        error: 'PASSWORD_RESET_INVALID',
        message: PASSWORD_RESET_INVALID_MESSAGE
      });
    }

    const consumedToken = await markPasswordResetTokenUsed(tokenRow.id);
    if (!consumedToken) {
      return res.status(400).json({
        error: 'PASSWORD_RESET_INVALID',
        message: PASSWORD_RESET_INVALID_MESSAGE
      });
    }

    await firebaseAdminAuth.updateUser(user.auth_provider_uid, { password: newPassword });
    await firebaseAdminAuth.revokeRefreshTokens(user.auth_provider_uid);

    return res.json({
      success: true,
      message: 'Your password has been reset. You can now sign in with your new password.'
    });
  } catch (error) {
    console.warn(`[password-reset] Reset-password request failed safely: ${error.message}`);
    return res.status(400).json({
      error: 'PASSWORD_RESET_FAILED',
      message: PASSWORD_RESET_INVALID_MESSAGE
    });
  }
});

if (process.env.NODE_ENV === 'test') {
  app.post('/api/test/auth/mock-firebase-login', (req, res) => {
    const { email, password } = req.body;
    const uid = `smoke:${email}`;
    const storedPassword = global.mockFirebasePasswords?.[uid];
    if (storedPassword && storedPassword === password) {
      return res.json({ success: true, token: uid });
    }
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid password.' });
  });
}

app.post('/api/auth/registration/start', async (req, res, next) => {
  try {
    const decodedToken = await verifyFirebaseOrSmokeRegistrationToken(req);
    const profile = req.body || {};
    const { user, organization } = await ensureRegistrationProfile(decodedToken, profile);
    const otpResult = await sendRegistrationOtpEmail({ user, organization });

    return res.status(202).json({
      email_verification_required: true,
      email: user.email,
      user_id: user.id,
      organization_id: organization.id,
      expires_at: otpResult.expiresAt.toISOString()
    });
  } catch (error) {
    if (error instanceof OtpError) {
      const mapped = mapOtpErrorToResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }

    if (error.code === 'email_not_configured' || error.code === 'EMAIL_CONFIGURATION_NOT_READY') {
      return res.status(503).json({
        error: 'REGISTRATION_EMAIL_NOT_CONFIGURED',
        message: 'Email verification is temporarily unavailable. Please try again later.'
      });
    }

    if (error.statusCode === 409) {
      return res.status(409).json({
        error: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration could not be completed with these details.'
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        message: 'Registration could not be completed.'
      });
    }

    next(error);
  }
});

app.post('/api/auth/registration/resend-otp', async (req, res, next) => {
  try {
    const decodedToken = await verifyFirebaseOrSmokeRegistrationToken(req);
    const email = normalizeEmail(decodedToken.email || req.body?.email);
    const user = await activeFindOne('users', { email });

    if (!user || user.email_verified || user.status !== 'pending_verification') {
      return res.status(400).json({
        error: 'REGISTRATION_OTP_UNAVAILABLE',
        message: 'A verification code cannot be resent for this registration.'
      });
    }

    const membership = await activeFindOne('organization_members', { user_id: user.id, role: 'landlord' });
    const organization = membership?.organization_id
      ? await activeFindOne('organizations', { id: membership.organization_id })
      : null;

    const otpResult = await sendRegistrationOtpEmail({ user, organization });
    return res.json({
      email_verification_required: true,
      email: user.email,
      expires_at: otpResult.expiresAt.toISOString()
    });
  } catch (error) {
    if (error instanceof OtpError) {
      const mapped = mapOtpErrorToResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }

    if (error.code === 'email_not_configured' || error.code === 'EMAIL_CONFIGURATION_NOT_READY') {
      return res.status(503).json({
        error: 'REGISTRATION_EMAIL_NOT_CONFIGURED',
        message: 'Email verification is temporarily unavailable. Please try again later.'
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        message: 'Verification code could not be resent.'
      });
    }

    next(error);
  }
});

app.post('/api/auth/registration/verify-email', async (req, res, next) => {
  try {
    const decodedToken = await verifyFirebaseOrSmokeRegistrationToken(req);
    const email = normalizeEmail(decodedToken.email || req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    const user = await activeFindOne('users', { email });

    if (!user || user.email_verified || user.status !== 'pending_verification') {
      return res.status(400).json({
        error: 'REGISTRATION_OTP_INVALID',
        message: 'The verification code is invalid or expired. Please request a new code if needed.'
      });
    }

    const membership = await activeFindOne('organization_members', { user_id: user.id, role: 'landlord' });
    const organization = membership?.organization_id
      ? await activeFindOne('organizations', { id: membership.organization_id })
      : null;

    try {
      await verifyOtp({
        pgDb: getOtpDb(),
        identifier: email,
        context: REGISTRATION_OTP_CONTEXT,
        otp,
        organizationId: organization?.id || null,
        userId: user.id
      });
    } catch (error) {
      await logRegistrationAudit(
        organization?.id,
        user.id,
        'registration_otp_failed',
        'Registration email OTP verification failed.',
        'failed',
        { email, context: REGISTRATION_OTP_CONTEXT, code: error.code || 'unknown' }
      );

      if (error instanceof OtpError && error.code === 'OTP_INVALID' && /0 attempts remaining/i.test(error.message || '')) {
        await invalidatePendingOtps({
          pgDb: getOtpDb(),
          identifier: email,
          context: REGISTRATION_OTP_CONTEXT
        });
      }

      const mapped = mapOtpErrorToResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }

    await logRegistrationAudit(
      organization?.id,
      user.id,
      'registration_otp_verified',
      'Registration email OTP verified.',
      'success',
      { email, context: REGISTRATION_OTP_CONTEXT }
    );

    await activeUpdate('users', user.id, {
      email_verified: true,
      status: 'active'
    });

    const verifiedUser = await activeFindOne('users', { id: user.id });

    await logRegistrationAudit(
      organization?.id,
      user.id,
      'registration_email_verified',
      'Registration email marked verified and account activated.',
      'success',
      { email }
    );

    const authToken = createSessionToken(verifiedUser, 'landlord', organization);
    return res.json({
      user: verifiedUser,
      role: 'landlord',
      organization,
      auth_token: authToken
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        message: 'Email verification could not be completed.'
      });
    }

    next(error);
  }
});

// --- FIREBASE AUTH PROFILE API ---
app.post('/api/auth/firebase-profile', async (req, res, next) => {
  try {
    const decodedToken = await verifyFirebaseOrSmokeRegistrationToken(req);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email || req.body.email;

    if (!firebaseUid) {
      return res.status(400).json({
        error: 'FIREBASE_UID_REQUIRED',
        message: 'Firebase account does not include a valid UID.'
      });
    }

    if (!email) {
      return res.status(400).json({
        error: 'EMAIL_REQUIRED',
        message: 'Firebase account does not include an email address.'
      });
    }

    const profile = req.body || {};
    const displayName = profile.name || decodedToken.name || email.split('@')[0];
    const phoneNumber = profile.phone_number || decodedToken.phone_number || '';

    let user = await activeFindOne('users', { auth_provider_uid: firebaseUid });

    if (!user) {
      user = await activeFindOne('users', { email });
    }

    if (!user) {
      const isEmailVerified = Boolean(decodedToken.email_verified);
      user = await activeInsert('users', {
        auth_provider_uid: firebaseUid,
        email,
        email_verified: isEmailVerified,
        phone_number: phoneNumber,
        phone_verified: Boolean(decodedToken.phone_number),
        name: displayName,
        first_name: splitFirstName(displayName),
        last_name: splitLastName(displayName),
        status: isEmailVerified ? 'active' : 'pending_verification'
      });
    } else if (!user.auth_provider_uid) {
      const isEmailVerified = Boolean(user.email_verified || decodedToken.email_verified);
      await activeUpdate('users', user.id, {
        auth_provider_uid: firebaseUid,
        email_verified: isEmailVerified,
        phone_verified: Boolean(user.phone_verified || decodedToken.phone_number),
        status: isEmailVerified ? 'active' : 'pending_verification'
      });

      user = await activeFindOne('users', { id: user.id });
    }

    let membership = await activeFindOne('organization_members', {
      user_id: user.id,
      status: 'active'
    });

    let organization = membership?.organization_id
      ? await activeFindOne('organizations', { id: membership.organization_id })
      : null;

    if (!organization) {
      const orgName = displayName;

      organization = await activeInsert('organizations', {
        owner_user_id: user.id,
        account_number: nextJsonOrganizationAccountNumber(),
        name: orgName,
        type: profile.type || 'individual',
        registration_number: profile.registration_number || '',
        tax_identifier: profile.tax_identifier || '',
        email,
        phone_number: phoneNumber,
        country: profile.country || 'Kenya',
        billing_currency: profile.billing_currency || 'KES',
        email_delivery_mode: EMAIL_MODES.PLATFORM,
        subscription_tier: 'standard',
        subscription_status: 'trial',
        trial_start_at: new Date().toISOString(),
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        subscription_expires_at: null,
        is_locked: false,
        security_pin_hash: '',
        status: 'active',
        profile_completed: false,
        profile_confirmed_at: null,
        kyc_status: 'incomplete'
      });

      membership = await activeInsert('organization_members', {
        organization_id: organization.id,
        user_id: user.id,
        role: 'landlord',
        status: 'active'
      });

      await activeInsert('notification_settings', {
        organization_id: organization.id,
        rent_reminders_enabled: true,
        reminder_days_before_due: 3,
        payment_confirmation_enabled: true,
        unmatched_payment_alert_enabled: true,
        meter_reading_alert_enabled: true,
        billing_alerts_enabled: true,
        sms_provider: 'None'
      });

      if (!pgDb && typeof db.logAudit === 'function') {
        db.logAudit(
          organization.id,
          user.id,
          'landlord',
          'firebase_register_landlord',
          'organization',
          organization.id,
          null,
          { org_id: organization.id, name: organization.name }
        );
      }
    }

    if (user.status === 'pending_verification' || user.email_verified === false) {
      return res.status(403).json({
        error: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Please verify your email address before continuing.'
      });
    }

    const role = user.is_super_admin ? 'super_admin' : (membership?.role || 'landlord');
    const organizationForSession = role === 'super_admin' ? null : organization;
    const authToken = createSessionToken(user, role, organizationForSession);

    return res.status(200).json({
      user,
      role,
      organization: organizationForSession,
      auth_token: authToken
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        message: error.message === 'FIREBASE_TOKEN_REQUIRED'
          ? 'A Firebase ID token is required.'
          : 'Failed to verify Firebase registration session.'
      });
    }

    if (
      error?.code === 'auth/id-token-expired' ||
      error?.code === 'auth/argument-error' ||
      error?.code === 'auth/id-token-revoked'
    ) {
      return res.status(401).json({
        error: 'INVALID_FIREBASE_TOKEN',
        message: 'Firebase session is invalid or expired. Please sign in again.'
      });
    }

    console.error('Firebase profile error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack
    });

    return res.status(500).json({
      error: 'FIREBASE_PROFILE_FAILED',
      code: error?.code || null,
      message: error?.message || 'Failed to create or load Firebase profile.'
    });
  }
});

// --- AUTH & SETUP API ---

// Mock Login
app.post('/api/auth/login', (req, res) => {
  if (!DEMO_MODE) {
    return res.status(503).json({
      error: 'MOCK_AUTH_DISABLED',
      message: 'Mock login is disabled outside demo mode. Configure the production auth provider before launch.'
    });
  }

  const { email, role: requestedRole } = req.body;

  // Find user by email
  let user = db.findOne('users', { email });
  if (!user) {
    // Return demo user if not found for testing convenience
    if (email.includes('admin')) {
      user = db.findOne('users', { id: 1 });
    } else if (email.includes('caretaker')) {
      user = db.findOne('users', { id: 3 });
    } else {
      user = db.findOne('users', { id: 2 });
    }
  }

  // Get organization membership
  const member = db.findOne('organization_members', { user_id: user.id });
  let org = null;
  if (member) {
    org = db.findOne('organizations', { id: member.organization_id });
  }

  const resolvedRole = user.is_super_admin ? 'super_admin' : (member ? member.role : (user.email.includes('admin') ? 'super_admin' : 'landlord'));
  const organizationForSession = resolvedRole === 'super_admin' ? null : org;
  const authToken = createSessionToken(user, resolvedRole, organizationForSession);

  db.logAudit(org ? org.id : null, user.id, resolvedRole || requestedRole || 'unknown', 'login', 'user', user.id, null, null, 'User logged in successfully', 'success');

  res.json({
    user,
    role: resolvedRole,
    organization: organizationForSession,
    auth_token: authToken
  });
});

// Register Landlord (Individual/Company)
app.post('/api/auth/register', async (req, res) => {
  if (!DEMO_MODE) {
    return res.status(503).json({
      error: 'MOCK_REGISTRATION_DISABLED',
      message: 'Mock registration is disabled outside demo mode. Configure verified email and phone registration before launch.'
    });
  }

  const {
    type,
    // Individual
    first_name,
    last_name,
    email,
    phone_number,
    country,
    billing_currency,
    // Company details
    company_name,
    registration_number,
    tax_identifier,
    company_phone_e164,
    company_email,
    // Representative details
    representative_first_name,
    representative_last_name,
    representative_role,
    representative_phone_e164,
    representative_email,
    representative_authorized,
    // Confirmation
    profile_confirmed
  } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  // Verify email duplicates
  const existingUser = await activeFindOne('users', { email });
  if (existingUser) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  let normalizedPhone;
  try {
    normalizedPhone = cleanAndNormalizePhoneNumber(phone_number, country || 'Kenya');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Check if phone number is already registered to another user
  const existingPhone = await activeFindOne('users', { phone_number: normalizedPhone });
  if (existingPhone) {
    return res.status(400).json({ error: 'This phone number is already registered to another user.' });
  }

  if (!profile_confirmed) {
    return res.status(400).json({ error: 'You must confirm the profile details are accurate.' });
  }

  let userFields = {
    email,
    email_verified: true, // Auto-verified in demo
    phone_number: normalizedPhone,
    phone_verified: true, // Auto-verified in demo
    status: 'active'
  };

  const accountNo = nextJsonOrganizationAccountNumber();
  let orgFields = {
    type,
    email: company_email || email,
    phone_number: company_phone_e164 || normalizedPhone,
    country: country || 'Kenya',
    billing_currency: billing_currency || 'KES',
    subscription_tier: 'standard',
    subscription_status: 'trial',
    trial_start_at: new Date().toISOString(),
    trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    subscription_expires_at: null,
    is_locked: false,
    security_pin_hash: '', // Set later
    status: 'active',
    profile_completed: true,
    profile_confirmed_at: new Date().toISOString(),
    kyc_status: 'completed'
  };

  if (accountNo !== undefined) {
    orgFields.account_number = accountNo;
  }

  if (type === 'individual') {
    if (!first_name || !first_name.trim() || !last_name || !last_name.trim()) {
      return res.status(400).json({ error: 'First name and last name are required for individual landlords.' });
    }
    userFields.first_name = first_name.trim();
    userFields.last_name = last_name.trim();
    userFields.name = `${first_name.trim()} ${last_name.trim()}`;
    orgFields.name = `${first_name.trim()} ${last_name.trim()}`;
    orgFields.tax_identifier = tax_identifier || '';
  } else if (type === 'company') {
    if (!company_name || !company_name.trim()) {
      return res.status(400).json({ error: 'Company name is required.' });
    }
    if (!registration_number || !registration_number.trim()) {
      return res.status(400).json({ error: 'Business registration number is required.' });
    }
    if (!tax_identifier || !tax_identifier.trim()) {
      return res.status(400).json({ error: 'KRA PIN / Tax Identifier is required.' });
    }
    if (!representative_first_name || !representative_first_name.trim() || !representative_last_name || !representative_last_name.trim()) {
      return res.status(400).json({ error: 'Representative first and last names are required.' });
    }
    if (!representative_role || !representative_role.trim()) {
      return res.status(400).json({ error: 'Representative role/title is required.' });
    }
    if (!representative_email || !representative_email.includes('@')) {
      return res.status(400).json({ error: 'A valid representative email is required.' });
    }
    if (!representative_authorized) {
      return res.status(400).json({ error: 'Representative must be authorized to represent the company.' });
    }

    let normRepPhone;
    try {
      normRepPhone = cleanAndNormalizePhoneNumber(representative_phone_e164, country || 'Kenya');
    } catch (err) {
      return res.status(400).json({ error: 'Representative phone: ' + err.message });
    }

    userFields.first_name = representative_first_name.trim();
    userFields.last_name = representative_last_name.trim();
    userFields.name = `${representative_first_name.trim()} ${representative_last_name.trim()}`;
    orgFields.name = company_name.trim();
    orgFields.registration_number = registration_number.trim();
    orgFields.tax_identifier = tax_identifier.trim();

    orgFields.representative_first_name = representative_first_name.trim();
    orgFields.representative_last_name = representative_last_name.trim();
    orgFields.representative_role = representative_role.trim();
    orgFields.representative_phone_e164 = normRepPhone;
    orgFields.representative_email = representative_email.trim();
    orgFields.representative_authorized = true;
  } else {
    return res.status(400).json({ error: 'Invalid profile type. Must be individual or company.' });
  }

  // 1. Create user
  const user = await activeInsert('users', userFields);
  orgFields.owner_user_id = user.id;

  // 2. Create organization
  const org = await activeInsert('organizations', orgFields);

  // 3. Create organization member
  await activeInsert('organization_members', {
    organization_id: org.id,
    user_id: user.id,
    role: 'landlord',
    status: 'active'
  });

  // 4. Create default notification settings
  await activeInsert('notification_settings', {
    organization_id: org.id,
    rent_reminders_enabled: true,
    reminder_days_before_due: 3,
    payment_confirmation_enabled: true,
    unmatched_payment_alert_enabled: true,
    meter_reading_alert_enabled: true,
    billing_alerts_enabled: true,
    sms_provider: 'None'
  });

  if (!pgDb && typeof db.logAudit === 'function') {
    db.logAudit(org.id, user.id, 'landlord', 'register_landlord', 'organization', org.id, null, { org_id: org.id, name: org.name });
  }
  const authToken = createSessionToken(user, 'landlord', org);

  res.status(201).json({
    user,
    role: 'landlord',
    organization: org,
    auth_token: authToken
  });
});

// Complete Profile / KYC verification
app.post('/api/auth/complete-profile', requireAuthenticated, async (req, res) => {
  const userId = req.auth.userId;
  const {
    type,
    // Individual
    first_name,
    last_name,
    // Company details
    company_name,
    registration_number,
    tax_identifier,
    company_phone_e164,
    company_email,
    // Representative details
    representative_first_name,
    representative_last_name,
    representative_role,
    representative_phone_e164,
    representative_email,
    representative_authorized,
    // Shared
    phone_number,
    country,
    billing_currency,
    profile_confirmed
  } = req.body;

  if (!profile_confirmed) {
    return res.status(400).json({ error: 'You must confirm the profile details are accurate.' });
  }

  // Get current user and membership
  let user = await activeFindOne('users', { id: userId });
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  let membership = await activeFindOne('organization_members', { user_id: user.id, role: 'landlord' });
  if (!membership) {
    return res.status(403).json({ error: 'Landlord profile membership not found.' });
  }

  let organization = await activeFindOne('organizations', { id: membership.organization_id });
  if (!organization) {
    return res.status(404).json({ error: 'Organization not found.' });
  }

  const resolvedCountry = country || organization.country || 'Kenya';
  const resolvedCurrency = billing_currency || organization.billing_currency || 'KES';

  let normalizedPhone;
  try {
    normalizedPhone = cleanAndNormalizePhoneNumber(phone_number || user.phone_number, resolvedCountry);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Check if phone number is already registered to another user (excluding current user)
  const existingPhone = await activeFindOne('users', { phone_number: normalizedPhone });
  if (existingPhone && existingPhone.id !== user.id) {
    return res.status(400).json({ error: 'This phone number is already registered to another user.' });
  }

  const userUpdates = {
    phone_number: normalizedPhone
  };
  const orgUpdates = {
    type,
    phone_number: company_phone_e164 || normalizedPhone,
    country: resolvedCountry,
    billing_currency: resolvedCurrency,
    profile_completed: true,
    profile_confirmed_at: new Date().toISOString(),
    kyc_status: 'completed'
  };

  if (type === 'individual') {
    if (!first_name || !first_name.trim() || !last_name || !last_name.trim()) {
      return res.status(400).json({ error: 'First name and last name are required for individual landlords.' });
    }
    userUpdates.first_name = first_name.trim();
    userUpdates.last_name = last_name.trim();
    userUpdates.name = `${first_name.trim()} ${last_name.trim()}`;

    orgUpdates.name = `${first_name.trim()} ${last_name.trim()}`;
    orgUpdates.tax_identifier = tax_identifier || '';
  } else if (type === 'company') {
    if (!company_name || !company_name.trim()) {
      return res.status(400).json({ error: 'Company name is required.' });
    }
    if (!registration_number || !registration_number.trim()) {
      return res.status(400).json({ error: 'Business registration number is required.' });
    }
    if (!tax_identifier || !tax_identifier.trim()) {
      return res.status(400).json({ error: 'KRA PIN / Tax Identifier is required.' });
    }
    if (!representative_first_name || !representative_first_name.trim() || !representative_last_name || !representative_last_name.trim()) {
      return res.status(400).json({ error: 'Representative first and last names are required.' });
    }
    if (!representative_role || !representative_role.trim()) {
      return res.status(400).json({ error: 'Representative role/title is required.' });
    }
    if (!representative_email || !representative_email.includes('@')) {
      return res.status(400).json({ error: 'A valid representative email is required.' });
    }
    if (!representative_authorized) {
      return res.status(400).json({ error: 'Representative must be authorized to represent the company.' });
    }

    let normRepPhone;
    try {
      normRepPhone = cleanAndNormalizePhoneNumber(representative_phone_e164, resolvedCountry);
    } catch (err) {
      return res.status(400).json({ error: 'Representative phone: ' + err.message });
    }

    userUpdates.first_name = representative_first_name.trim();
    userUpdates.last_name = representative_last_name.trim();
    userUpdates.name = `${representative_first_name.trim()} ${representative_last_name.trim()}`;

    orgUpdates.name = company_name.trim();
    orgUpdates.registration_number = registration_number.trim();
    orgUpdates.tax_identifier = tax_identifier.trim();
    orgUpdates.email = company_email || organization.email;
    orgUpdates.phone_number = company_phone_e164 || organization.phone_number;

    orgUpdates.representative_first_name = representative_first_name.trim();
    orgUpdates.representative_last_name = representative_last_name.trim();
    orgUpdates.representative_role = representative_role.trim();
    orgUpdates.representative_phone_e164 = normRepPhone;
    orgUpdates.representative_email = representative_email.trim();
    orgUpdates.representative_authorized = true;
  } else {
    return res.status(400).json({ error: 'Invalid profile type.' });
  }

  // Update user in DB
  await activeUpdate('users', user.id, userUpdates);
  // Update organization in DB
  await activeUpdate('organizations', organization.id, orgUpdates);

  // Fetch updated records
  const updatedUser = await activeFindOne('users', { id: user.id });
  const updatedOrg = await activeFindOne('organizations', { id: organization.id });

  // Update session token with updated info
  const newAuthToken = createSessionToken(updatedUser, 'landlord', updatedOrg);

  if (!pgDb && typeof db.logAudit === 'function') {
    db.logAudit(updatedOrg.id, updatedUser.id, 'landlord', 'complete_profile', 'organization', updatedOrg.id, null, { org_id: updatedOrg.id, name: updatedOrg.name });
  }

  res.json({
    success: true,
    user: updatedUser,
    organization: updatedOrg,
    auth_token: newAuthToken
  });
});

// Setup Security PIN
app.post('/api/auth/setup-pin', (req, res) => {
  const { organization_id, pin } = req.body;
  if (!pin || pin.length !== 6) {
    return res.status(400).json({ error: 'PIN must be exactly 6 digits.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(pin, salt);

  db.update('organizations', parseInt(organization_id), { security_pin_hash: hash });

  const org = db.findOne('organizations', { id: parseInt(organization_id) });

  db.logAudit(parseInt(organization_id), org.owner_user_id, 'landlord', 'security_pin_created', 'organization', org.id, null, null, 'Security PIN configured', 'success');

  res.json({ success: true, message: 'Security PIN configured successfully.' });
});

// Verify PIN
app.post('/api/auth/verify-pin', (req, res) => {
  const { organization_id, pin } = req.body;
  const org = db.findOne('organizations', { id: parseInt(organization_id) });

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  if (!org.security_pin_hash) {
    return res.status(400).json({ error: 'PIN has not been set up yet.' });
  }

  const isValid = bcrypt.compareSync(pin, org.security_pin_hash);

  if (!isValid) {
    db.logAudit(org.id, org.owner_user_id, 'landlord', 'pin_verification_failed', 'organization', org.id, null, null, 'Failed PIN verification', 'failed');
    return res.status(400).json({ error: 'The security PIN is incorrect. This attempt has been logged.' });
  }

  res.json({ success: true });
});

// Caretaker Login
app.post('/api/auth/caretaker/login', async (req, res) => {
  try {
    const { phone_number, pin } = req.body;
    const user = phone_number ? await activeFindOne('users', { phone_number }) : null;
    const membership = user ? await findCaretakerMembership(user.id) : null;

    if (!phone_number || !isValidCaretakerPin(pin)) {
      await recordCaretakerLoginFailure(user, membership, 'invalid_pin_format');
      return res.status(401).json({ error: CARETAKER_LOGIN_ERROR });
    }

    if (!user || !user.caretaker_pin_hash) {
      return res.status(401).json({ error: CARETAKER_LOGIN_ERROR });
    }

    const lockedUntil = getCaretakerLockedUntil(user);
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      await logCaretakerAuditSafe(
        membership?.organization_id,
        user.id,
        'caretaker_login_locked',
        'Caretaker login rejected during active lockout.',
        'failed'
      );
      return res.status(423).json({ error: 'Caretaker login is temporarily locked. Please try again later.' });
    }

    const effectiveUser = lockedUntil ? {
      ...user,
      caretaker_failed_login_attempts: 0,
      caretaker_locked_until: null,
      caretaker_last_failed_login_at: null
    } : user;

    const isValid = bcrypt.compareSync(pin, effectiveUser.caretaker_pin_hash);
    if (!isValid) {
      await recordCaretakerLoginFailure(effectiveUser, membership, 'invalid_credentials');
      return res.status(401).json({ error: CARETAKER_LOGIN_ERROR });
    }

    if (!membership || membership.status !== 'active') {
      await recordCaretakerLoginFailure(effectiveUser, membership, 'inactive_or_missing_membership');
      return res.status(401).json({ error: CARETAKER_LOGIN_ERROR });
    }

    const organization = await activeFindOne('organizations', { id: membership.organization_id });
    const token = createSessionToken(user, 'caretaker', organization);
    await resetCaretakerLoginState(user.id);

    await logCaretakerAuditSafe(
      organization.id,
      user.id,
      'caretaker_login_success',
      'Caretaker logged in successfully.',
      'success'
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        status: user.status
      },
      role: 'caretaker',
      organization,
      auth_token: token
    });
  } catch (error) {
    console.error('Caretaker login server error:', error);
    res.status(500).json({ error: 'Caretaker login is temporarily unavailable.' });
  }
});

// --- ROUTE-LEVEL AUTHORIZATION GUARDS ---

app.use('/api/properties', requireAuthenticated, requireAnyRole('landlord', 'caretaker'));
app.use('/api/units', requireAuthenticated, requireAnyRole('landlord', 'caretaker'));
app.use('/api/tenants', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/invoices', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/payments', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/reconciliation', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/meter-readings', requireAuthenticated, requireAnyRole('landlord', 'caretaker'));
app.use('/api/messages', requireAuthenticated, requireAnyRole('landlord', 'caretaker'));
app.use('/api/settings', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/integrations', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/saas', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/compliance', requireAuthenticated, requireAnyRole('landlord'));
app.use('/api/maintenance', requireAuthenticated, requireAnyRole('landlord', 'caretaker'));

app.use('/api/admin', requireAuthenticated, requireAnyRole('super_admin'));

if (pgDb) {
  app.use('/api', createWebhookRoutes(pgDb, { demoMode: DEMO_MODE }));
  app.use('/api', createPropertyRoutes(pgDb));
  app.use('/api', createFinancialRoutes(pgDb));
  app.use('/api', createReconciliationRoutes(pgDb));
  app.use('/api', createIntegrationRoutes(pgDb));
}

// Mount notification routes (supports both PostgreSQL and JSON DB backends)
app.use('/api', createNotificationRoutes(pgDb));
app.use('/api', createPaymentEvidenceRoutes(pgDb));

// Mount platform billing and admin routes (supports both PostgreSQL and JSON DB backends)
app.use('/api', createSaasBillingRoutes(pgDb, {
  demoMode: DEMO_MODE,
  sessionSecret: SESSION_SECRET,
  sessionTtlSeconds: SESSION_TTL_SECONDS,
  createSessionToken
}));

// --- PROPERTIES / UNITS / TENANTS API ---

// Caretakers (JSON DB)
app.get('/api/properties/caretakers', (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;

  if (role !== 'landlord') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Only landlords can manage staff.' });
  }

  const members = db.find('organization_members', { organization_id: orgId, role: 'caretaker' })
    .filter(m => m.status === 'active' || m.status === 'disabled');
  const caretakers = members.map(m => {
    const u = db.findOne('users', { id: m.user_id });
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone_number: u.phone_number,
      status: m.status
    };
  }).filter(Boolean);

  const caretakersWithProps = caretakers.map(ct => {
    const assignments = db.find('staff_assignments', { caretaker_user_id: ct.id, organization_id: orgId });
    const assignmentIds = assignments.map(a => a.id);
    const sapLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const properties = sapLinks.map(link => {
      const p = db.findOne('properties', { id: link.property_id });
      if (p && Number(p.organization_id) === Number(orgId) && !p.deleted_at) {
        return { id: p.id, name: p.name };
      }
      return null;
    }).filter(Boolean);

    return {
      ...ct,
      properties
    };
  });

  res.json(caretakersWithProps);
});

app.post('/api/properties/caretakers', (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const { name, email, phone_number, assigned_properties, pin: requestedPin } = req.body;

  if (role !== 'landlord') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Only landlords can manage staff.' });
  }

  if (!name || !phone_number) {
    return res.status(400).json({ error: 'Name and phone number are required.' });
  }

  // Check if caretaker already exists by phone number
  let user = db.findOne('users', { phone_number });
  if (user) {
    const existingMembership = db.findOne('organization_members', { user_id: user.id });
    if (existingMembership) {
      return res.status(400).json({ error: 'This phone number is already registered to another user.' });
    }
  }

  // Validate assigned properties
  const propIds = Array.isArray(assigned_properties) ? assigned_properties : [];
  const uniquePropIds = [];
  for (const id of propIds) {
    const parsed = parseInt(id, 10);
    if (isNaN(parsed) || String(id).trim() === '' || parsed.toString() !== String(id).trim()) {
      return res.status(400).json({ error: 'One or more selected properties are invalid.' });
    }
    if (!uniquePropIds.includes(parsed)) {
      uniquePropIds.push(parsed);
    }
  }

  for (const propId of uniquePropIds) {
    const property = db.findOne('properties', { id: propId });
    if (!property || Number(property.organization_id) !== Number(orgId) || property.deleted_at) {
      return res.status(400).json({ error: 'One or more selected properties are invalid.' });
    }
  }

  const pin = requestedPin !== undefined ? String(requestedPin) : generateCaretakerPin();
  if (!isValidCaretakerPin(pin)) {
    return res.status(400).json({ error: 'Caretaker PIN must be exactly 6 numeric digits.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const pinHash = bcrypt.hashSync(pin, salt);

  if (!user) {
    user = db.insert('users', {
      name,
      email: email || null,
      phone_number,
      caretaker_pin_hash: pinHash,
      caretaker_failed_login_attempts: 0,
      caretaker_locked_until: null,
      caretaker_last_failed_login_at: null,
      status: 'active',
      email_verified: false,
      phone_verified: false
    });
  } else {
    db.update('users', user.id, {
      caretaker_pin_hash: pinHash,
      caretaker_failed_login_attempts: 0,
      caretaker_locked_until: null,
      caretaker_last_failed_login_at: null
    });
    user = db.findOne('users', { id: user.id });
  }

  // Create organization member
  db.insert('organization_members', {
    organization_id: orgId,
    user_id: user.id,
    role: 'caretaker',
    status: 'active'
  });

  // Create staff assignment
  const assignment = db.insert('staff_assignments', {
    organization_id: orgId,
    caretaker_user_id: user.id,
    access_level: 'caretaker',
    status: 'active',
    created_by: userId
  });

  // Create property links
  for (const propId of uniquePropIds) {
    db.insert('staff_assignment_properties', {
      organization_id: orgId,
      staff_assignment_id: assignment.id,
      property_id: propId
    });
  }

  db.logAudit(orgId, userId, role, 'caretaker_created', 'user', user.id, null, { id: user.id, name: user.name });

  res.status(201).json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone_number: user.phone_number,
      status: user.status
    }
  });
});

app.put('/api/properties/caretakers/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const caretakerId = Number(req.params.id);

  if (role !== 'landlord') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Only landlords can manage staff.' });
  }

  // Ensure caretaker belongs to this organization
  const member = db.findOne('organization_members', { organization_id: orgId, user_id: caretakerId, role: 'caretaker' });
  if (!member) {
    return res.status(404).json({ error: 'Caretaker not found in this organization.' });
  }

  const { name, phone_number, email, status, assigned_properties, pin } = req.body;

  if (!name || !phone_number) {
    return res.status(400).json({ error: 'Name and phone number are required.' });
  }

  // Check if phone number is already registered to another user
  const existingUser = db.findOne('users', { phone_number });
  if (existingUser && Number(existingUser.id) !== caretakerId) {
    return res.status(400).json({ error: 'This phone number is already registered to another user.' });
  }

  // Validate assigned properties
  const propIds = Array.isArray(assigned_properties) ? assigned_properties : [];
  const uniquePropIds = [];
  for (const id of propIds) {
    const parsed = parseInt(id, 10);
    if (isNaN(parsed) || String(id).trim() === '' || parsed.toString() !== String(id).trim()) {
      return res.status(400).json({ error: 'One or more selected properties are invalid.' });
    }
    if (!uniquePropIds.includes(parsed)) {
      uniquePropIds.push(parsed);
    }
  }

  for (const propId of uniquePropIds) {
    const property = db.findOne('properties', { id: propId });
    if (!property || Number(property.organization_id) !== Number(orgId) || property.deleted_at) {
      return res.status(400).json({ error: 'One or more selected properties are invalid.' });
    }
  }

  // Update user details
  const updateData = { name, phone_number };
  if (email !== undefined) {
    updateData.email = email || null;
  }
  if (status && ['active', 'disabled'].includes(status)) {
    updateData.status = status;
  }
  if (pin !== undefined) {
    const nextPin = String(pin);
    if (!isValidCaretakerPin(nextPin)) {
      return res.status(400).json({ error: 'Caretaker PIN must be exactly 6 numeric digits.' });
    }
    const salt = bcrypt.genSaltSync(10);
    updateData.caretaker_pin_hash = bcrypt.hashSync(nextPin, salt);
    updateData.caretaker_failed_login_attempts = 0;
    updateData.caretaker_locked_until = null;
    updateData.caretaker_last_failed_login_at = null;
  }
  db.update('users', caretakerId, updateData);

  // Update membership status
  if (status && ['active', 'disabled'].includes(status)) {
    db.update('organization_members', member.id, { status });
  }

  // Update staff assignments status
  let assignment = db.findOne('staff_assignments', { caretaker_user_id: caretakerId, organization_id: orgId });
  if (!assignment) {
    assignment = db.insert('staff_assignments', {
      organization_id: orgId,
      caretaker_user_id: caretakerId,
      access_level: 'caretaker',
      status: status || 'active',
      created_by: userId
    });
  } else {
    const updateAssignment = {};
    if (status && ['active', 'disabled'].includes(status)) {
      updateAssignment.status = status;
    }
    db.update('staff_assignments', assignment.id, updateAssignment);
  }

  // Re-link properties: remove old ones, insert new ones
  db.delete('staff_assignment_properties', { staff_assignment_id: assignment.id, organization_id: orgId });
  for (const propId of uniquePropIds) {
    db.insert('staff_assignment_properties', {
      organization_id: orgId,
      staff_assignment_id: assignment.id,
      property_id: propId
    });
  }

  const updatedUser = db.findOne('users', { id: caretakerId });
  db.logAudit(orgId, userId, role, 'caretaker_updated', 'user', caretakerId, null, { id: updatedUser.id, name: updatedUser.name });

  res.json({ success: true, user: updatedUser });
});

app.post('/api/properties/caretakers/:id/reset-pin', (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const caretakerId = Number(req.params.id);
  const { pin: requestedPin } = req.body || {};

  if (role !== 'landlord') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Only landlords can manage staff.' });
  }

  // Ensure caretaker belongs to this organization
  const member = db.findOne('organization_members', { organization_id: orgId, user_id: caretakerId, role: 'caretaker' });
  if (!member) {
    return res.status(404).json({ error: 'Caretaker not found in this organization.' });
  }

  const pin = requestedPin !== undefined ? String(requestedPin) : generateCaretakerPin();
  if (!isValidCaretakerPin(pin)) {
    return res.status(400).json({ error: 'Caretaker PIN must be exactly 6 numeric digits.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const pinHash = bcrypt.hashSync(pin, salt);

  db.update('users', caretakerId, {
    caretaker_pin_hash: pinHash,
    caretaker_failed_login_attempts: 0,
    caretaker_locked_until: null,
    caretaker_last_failed_login_at: null
  });
  const updatedUser = db.findOne('users', { id: caretakerId });

  db.logAudit(orgId, userId, role, 'caretaker_pin_reset', 'user', caretakerId, null, null, 'Caretaker PIN reset');

  res.json({
    success: true,
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      phone_number: updatedUser.phone_number
    }
  });
});

// Properties
app.get('/api/properties', (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  let properties = db.find('properties', { organization_id: orgId, deleted_at: null });

  // Caretaker restrictions
  if (role === 'caretaker') {
    const assignments = db.find('staff_assignments', { caretaker_user_id: userId, status: 'active' });
    const assignmentIds = assignments.map(a => a.id);
    const assignedPropLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const assignedPropIds = assignedPropLinks.map(link => link.property_id);

    properties = properties.filter(p => assignedPropIds.includes(p.id));
  }

  // Calculate stats for properties
  const units = db.get('units');
  const tenants = db.get('tenants');
  const invoices = db.get('invoices');

  const detailedProperties = properties.map(prop => {
    const propUnits = units.filter(u => u.property_id === prop.id && !u.deleted_at);
    const vacantCount = propUnits.filter(u => u.status === 'vacant').length;
    const occupiedCount = propUnits.filter(u => u.status === 'occupied').length;
    const underMaintCount = propUnits.filter(u => u.status === 'under_maintenance').length;

    // Financial stats (June 2026 expected)
    const expected = propUnits.reduce((acc, curr) => acc + (curr.rent_amount || 0), 0);
    const paid = invoices
      .filter(inv => inv.property_id === prop.id && inv.status === 'paid')
      .reduce((acc, curr) => acc + (curr.amount_paid || 0), 0);
    const arrears = invoices
      .filter(inv => inv.property_id === prop.id && (inv.status === 'overdue' || inv.status === 'partially_paid'))
      .reduce((acc, curr) => acc + (curr.balance || 0), 0);

    return {
      ...prop,
      total_units: propUnits.length,
      vacant_units: vacantCount,
      occupied_units: occupiedCount,
      maintenance_units: underMaintCount,
      expected_rent: expected,
      collected_rent: paid,
      arrears
    };
  });

  res.json(detailedProperties);
});

app.post('/api/properties', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { name, property_type, location, county, town, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const prop = db.insert('properties', {
    organization_id: orgId,
    name,
    property_type,
    location,
    county,
    town,
    status: 'active',
    notes,
    deleted_at: null
  });

  db.logAudit(orgId, userId, role, 'property_created', 'property', prop.id, null, prop);

  res.status(201).json(prop);
});

app.put('/api/properties/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const propId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const oldVal = db.findOne('properties', { id: propId, organization_id: orgId });

  const updated = db.update('properties', { id: propId, organization_id: orgId }, req.body);

  db.logAudit(orgId, userId, role, 'property_updated', 'property', propId, oldVal, updated[0]);
  res.json(updated[0]);
});

app.delete('/api/properties/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const propId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  // Soft delete properties, units, and vacate tenants
  const oldVal = db.findOne('properties', { id: propId, organization_id: orgId });
  db.update('properties', { id: propId, organization_id: orgId }, { deleted_at: new Date().toISOString(), status: 'inactive' });
  db.update('units', { property_id: propId, organization_id: orgId }, { deleted_at: new Date().toISOString(), status: 'inactive' });
  db.update('tenants', { property_id: propId, organization_id: orgId }, { status: 'inactive', move_out_date: new Date().toISOString().split('T')[0] });

  db.logAudit(orgId, userId, role, 'property_deleted', 'property', propId, oldVal, null);
  res.json({ success: true });
});

// Units
app.get('/api/units', (req, res) => {
  const orgId = req.auth?.organizationId;
  const propertyId = req.query.property_id ? parseInt(req.query.property_id) : null;
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  let query = { organization_id: orgId, deleted_at: null };
  if (propertyId) query.property_id = propertyId;

  let units = db.find('units', query);

  // Caretaker restrictions
  if (role === 'caretaker') {
    const assignments = db.find('staff_assignments', { caretaker_user_id: userId, status: 'active' });
    const assignmentIds = assignments.map(a => a.id);
    const assignedPropLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const assignedPropIds = assignedPropLinks.map(link => link.property_id);

    units = units.filter(u => assignedPropIds.includes(u.property_id));
  }

  const tenants = db.get('tenants');
  const properties = db.get('properties');

  const detailedUnits = units.map(u => {
    const prop = properties.find(p => p.id === u.property_id);
    const activeTenant = tenants.find(t => t.unit_id === u.id && t.status === 'active');
    return {
      ...u,
      property_name: prop ? prop.name : 'Unknown Property',
      tenant_name: activeTenant ? activeTenant.full_name : 'Vacant',
      tenant_id: activeTenant ? activeTenant.id : null
    };
  });

  res.json(detailedUnits);
});

app.post('/api/units', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { property_id, unit_code, unit_type, rent_amount, deposit_amount, floor, block, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const unit = db.insert('units', {
    organization_id: orgId,
    property_id: parseInt(property_id),
    unit_code,
    unit_type,
    rent_amount: parseFloat(rent_amount),
    deposit_amount: parseFloat(deposit_amount),
    status: 'vacant',
    floor: floor || '',
    block: block || '',
    notes: notes || '',
    deleted_at: null
  });

  db.logAudit(orgId, userId, role, 'unit_created', 'unit', unit.id, null, unit);
  res.status(201).json(unit);
});

app.put('/api/units/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const unitId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const oldVal = db.findOne('units', { id: unitId, organization_id: orgId });

  const updated = db.update('units', { id: unitId, organization_id: orgId }, req.body);

  db.logAudit(orgId, userId, role, 'unit_updated', 'unit', unitId, oldVal, updated[0]);
  res.json(updated[0]);
});

app.delete('/api/units/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const unitId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const oldVal = db.findOne('units', { id: unitId, organization_id: orgId });
  db.update('units', { id: unitId, organization_id: orgId }, { deleted_at: new Date().toISOString(), status: 'inactive' });
  db.update('tenants', { unit_id: unitId, organization_id: orgId }, { status: 'inactive', move_out_date: new Date().toISOString().split('T')[0] });

  db.logAudit(orgId, userId, role, 'unit_deleted', 'unit', unitId, oldVal, null);
  res.json({ success: true });
});

// Tenants
app.get('/api/tenants', (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  let tenants = db.find('tenants', { organization_id: orgId, deleted_at: null });

  // Caretaker restrictions
  if (role === 'caretaker') {
    const assignments = db.find('staff_assignments', { caretaker_user_id: userId, status: 'active' });
    const assignmentIds = assignments.map(a => a.id);
    const assignedPropLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const assignedPropIds = assignedPropLinks.map(link => link.property_id);

    tenants = tenants.filter(t => assignedPropIds.includes(t.property_id));
  }

  const properties = db.get('properties');
  const units = db.get('units');
  const invoices = db.get('invoices');
  const transactions = db.get('transactions');

  const detailedTenants = tenants.map(t => {
    const prop = properties.find(p => p.id === t.property_id);
    const unit = units.find(u => u.id === t.unit_id);

    // Balance calculation
    const unpaidInvoices = invoices.filter(inv => inv.tenant_id === t.id && inv.status !== 'paid' && inv.status !== 'void');
    const totalArrears = unpaidInvoices.reduce((sum, inv) => sum + (inv.balance || 0), 0);

    const tenantPayments = transactions.filter(tx => tx.tenant_id === t.id && tx.transaction_type === 'payment' && tx.status === 'reconciled');
    const lastPayment = tenantPayments.reduce((latest, current) => {
      if (!latest || new Date(current.transaction_date) > new Date(latest.transaction_date)) {
        return current;
      }
      return latest;
    }, null);

    return {
      ...t,
      property_name: prop ? prop.name : 'Unknown Property',
      unit_code: unit ? unit.unit_code : 'Unknown Unit',
      balance: totalArrears,
      last_payment_amount: lastPayment ? lastPayment.amount : null,
      last_payment_date: lastPayment ? lastPayment.transaction_date : null
    };
  });

  res.json(detailedTenants);
});

app.post('/api/tenants', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { property_id, unit_id, full_name, phone_number, email, id_number, move_in_date, rent_amount, billing_day, emergency_contact_name, emergency_contact_phone, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  // Generate tenant account number based on org id, property id and unit code
  const prop = db.findOne('properties', { id: parseInt(property_id) });
  const unit = db.findOne('units', { id: parseInt(unit_id) });
  const unitCode = unit ? unit.unit_code.replace(/[^a-zA-Z0-9]/g, '') : 'UN';
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const tenantAccountNumber = `ACC-${orgId}${property_id}-${unitCode}`;

  const tenant = db.insert('tenants', {
    organization_id: orgId,
    property_id: parseInt(property_id),
    unit_id: parseInt(unit_id),
    tenant_identifier: `TID-${randNum}`,
    tenant_account_number: tenantAccountNumber,
    full_name,
    phone_number,
    email,
    id_number: id_number || '',
    move_in_date,
    move_out_date: null,
    rent_amount: parseFloat(rent_amount),
    billing_day: parseInt(billing_day) || 1,
    status: 'active',
    emergency_contact_name: emergency_contact_name || '',
    emergency_contact_phone: emergency_contact_phone || '',
    notes: notes || '',
    deleted_at: null
  });

  // Automatically update unit status to occupied
  db.update('units', parseInt(unit_id), { status: 'occupied' });

  db.logAudit(orgId, userId, role, 'tenant_created', 'tenant', tenant.id, null, tenant);
  res.status(201).json(tenant);
});

app.put('/api/tenants/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const tenantId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const oldVal = db.findOne('tenants', { id: tenantId, organization_id: orgId });
  const updated = db.update('tenants', { id: tenantId, organization_id: orgId }, req.body);

  // If status changes to vacated/inactive, free up the unit
  if (req.body.status && req.body.status !== 'active' && req.body.status !== 'notice') {
    if (oldVal && oldVal.unit_id) {
      db.update('units', oldVal.unit_id, { status: 'vacant' });
    }
  }

  db.logAudit(orgId, userId, role, 'tenant_updated', 'tenant', tenantId, oldVal, updated[0]);
  res.json(updated[0]);
});

app.post('/api/tenants/:id/vacate', (req, res) => {
  const orgId = req.auth?.organizationId;
  const tenantId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const oldVal = db.findOne('tenants', { id: tenantId, organization_id: orgId });
  if (!oldVal) {
    return res.status(404).json({ error: 'Tenant not found' });
  }

  const updated = db.update('tenants', tenantId, {
    status: 'vacated',
    move_out_date: new Date().toISOString().split('T')[0]
  });

  // Free unit
  db.update('units', oldVal.unit_id, { status: 'vacant' });

  db.logAudit(orgId, userId, role, 'tenant_vacated', 'tenant', tenantId, oldVal, updated[0]);
  res.json(updated[0]);
});

// --- INVOICES API ---

app.get('/api/invoices', (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoices = db.find('invoices', { organization_id: orgId });
  const tenants = db.get('tenants');
  const properties = db.get('properties');
  const units = db.get('units');

  const detailedInvoices = invoices.map(inv => {
    const tenant = tenants.find(t => t.id === inv.tenant_id);
    const prop = properties.find(p => p.id === inv.property_id);
    const unit = units.find(u => u.id === inv.unit_id);
    return {
      ...inv,
      tenant_name: tenant ? tenant.full_name : 'Unknown Tenant',
      property_name: prop ? prop.name : 'Unknown Property',
      unit_code: unit ? unit.unit_code : 'Unknown Unit'
    };
  });

  res.json(detailedInvoices);
});

app.post('/api/invoices', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { tenant_id, invoice_type, issue_date, due_date, items, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  // Retrieve tenant info
  const tenant = db.findOne('tenants', { id: parseInt(tenant_id), organization_id: orgId });
  if (!tenant) {
    return res.status(400).json({ error: 'Tenant not found.' });
  }

  // Invoice calculations
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unit_price)), 0);
  const total = subtotal;

  const randNum = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-2026-${randNum}`;

  // 1. Create Invoice
  const invoice = db.insert('invoices', {
    organization_id: orgId,
    property_id: tenant.property_id,
    unit_id: tenant.unit_id,
    tenant_id: tenant.id,
    invoice_number: invoiceNumber,
    invoice_type: invoice_type || 'rent',
    status: 'draft',
    issue_date,
    due_date,
    currency: tenant.currency || 'KES',
    subtotal,
    total,
    amount_paid: 0,
    balance: total,
    notes: notes || '',
    created_by: userId,
    issued_at: null,
    voided_at: null,
    voided_by: null
  });

  // 2. Insert invoice items
  items.forEach(item => {
    db.insert('invoice_items', {
      organization_id: orgId,
      invoice_id: invoice.id,
      description: item.description,
      item_type: item.item_type || 'other',
      quantity: parseInt(item.quantity) || 1,
      unit_price: parseFloat(item.unit_price),
      total: parseInt(item.quantity) * parseFloat(item.unit_price)
    });
  });

  db.logAudit(orgId, userId, role, 'invoice_created', 'invoice', invoice.id, null, invoice);
  res.status(201).json(invoice);
});

// Update draft invoice
app.put('/api/invoices/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoiceId = parseInt(req.params.id);
  const { items, notes, due_date, issue_date, invoice_type } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const invoice = db.findOne('invoices', { id: invoiceId, organization_id: orgId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') {
    return res.status(400).json({ error: 'Only draft invoices can be edited.' });
  }

  // Recalculate
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unit_price)), 0);
  const total = subtotal;

  // Update items: delete existing and insert new
  db.delete('invoice_items', { invoice_id: invoiceId, organization_id: orgId });
  items.forEach(item => {
    db.insert('invoice_items', {
      organization_id: orgId,
      invoice_id: invoiceId,
      description: item.description,
      item_type: item.item_type || 'other',
      quantity: parseInt(item.quantity) || 1,
      unit_price: parseFloat(item.unit_price),
      total: parseInt(item.quantity) * parseFloat(item.unit_price)
    });
  });

  const updated = db.update('invoices', invoiceId, {
    subtotal,
    total,
    balance: total,
    notes: notes || '',
    due_date: due_date || invoice.due_date,
    issue_date: issue_date || invoice.issue_date,
    invoice_type: invoice_type || invoice.invoice_type
  });

  db.logAudit(orgId, userId, role, 'invoice_updated', 'invoice', invoiceId, invoice, updated[0]);
  res.json(updated[0]);
});

// Get single invoice details
app.get('/api/invoices/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoiceId = parseInt(req.params.id);
  const invoice = db.findOne('invoices', { id: invoiceId, organization_id: orgId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const items = db.find('invoice_items', { invoice_id: invoiceId, organization_id: orgId });
  const tenant = db.findOne('tenants', { id: invoice.tenant_id });
  const property = db.findOne('properties', { id: invoice.property_id });
  const unit = db.findOne('units', { id: invoice.unit_id });

  res.json({
    ...invoice,
    items,
    tenant,
    property,
    unit
  });
});

// Issue Invoice
app.post('/api/invoices/:id/issue', (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoiceId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const invoice = db.findOne('invoices', { id: invoiceId, organization_id: orgId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const updated = db.update('invoices', invoiceId, {
    status: 'issued',
    issued_at: new Date().toISOString()
  });

  db.logAudit(orgId, userId, role, 'invoice_issued', 'invoice', invoiceId, invoice, updated[0]);

  // Log mock notification log
  // Log mock notification log
  const tenant = db.findOne('tenants', { id: invoice.tenant_id });
  if (tenant) {
    const notificationService = new NotificationService(null);
    notificationService.queue({
      organizationId: orgId,
      tenantId: tenant.id,
      channel: 'sms',
      type: 'invoice_issued',
      data: {
        invoice_number: invoice.invoice_number,
        amount: invoice.total,
        due_date: invoice.due_date,
        account_number: tenant.tenant_account_number
      }
    });
  }

  res.json(updated[0]);
});

// Void Invoice (Requires PIN in frontend UI flow, API logs validation)
app.post('/api/invoices/:id/void', (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoiceId = parseInt(req.params.id);
  const { pin } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const org = db.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const invoice = db.findOne('invoices', { id: invoiceId, organization_id: orgId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') {
    return res.status(400).json({ error: 'Paid invoices cannot be voided.' });
  }

  const updated = db.update('invoices', invoiceId, {
    status: 'void',
    voided_at: new Date().toISOString(),
    voided_by: userId
  });

  db.logAudit(orgId, userId, role, 'invoice_voided', 'invoice', invoiceId, invoice, updated[0], 'Voided issued invoice', 'success');
  res.json(updated[0]);
});

// Send Rent Reminder (multi-channel: sms, email, whatsapp)
app.post('/api/invoices/:id/send-reminder', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const invoiceId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'You do not have permission to send reminders.' });
  }

  const invoice = db.findOne('invoices', { id: invoiceId, organization_id: orgId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

  if (['draft', 'void', 'paid'].includes(invoice.status)) {
    return res.status(400).json({ error: `Cannot send reminder for a ${invoice.status} invoice.` });
  }

  const tenant = db.findOne('tenants', { id: invoice.tenant_id });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const { channel = 'sms' } = req.body;
  const validChannels = ['sms', 'email', 'whatsapp'];
  if (!validChannels.includes(channel)) {
    return res.status(400).json({ error: 'Invalid channel. Choose sms, email, or whatsapp.' });
  }

  const daysOverdue = Math.max(0, Math.floor((Date.now() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24)));
  const overdueNote = daysOverdue > 0 ? ` — ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue` : '';
  const org = db.findOne('organizations', { id: orgId });
  const mpesaIntegration = db.findOne('organization_integrations', {
    organization_id: orgId,
    provider_type: 'mpesa',
    is_active: true
  });
  const landlordPaybill = String(mpesaIntegration?.shortcode || '').trim();

  // Build channel-appropriate message
  let message;
  if (channel === 'sms') {
    message = landlordPaybill
      ? `Dear ${tenant.full_name}, this is a payment reminder for invoice ${invoice.invoice_number}. Balance: KES ${invoice.balance.toLocaleString()}${overdueNote}. Due: ${invoice.due_date}. Pay via Paybill ${landlordPaybill}, Acct: ${tenant.tenant_account_number}. Thank you.`
      : `Dear ${tenant.full_name}, this is a payment reminder for invoice ${invoice.invoice_number}. Balance: KES ${invoice.balance.toLocaleString()}${overdueNote}. Due: ${invoice.due_date}. M-Pesa Paybill is not configured for this property. Please contact management before making payment. Acct: ${tenant.tenant_account_number}. Thank you.`;
  } else if (channel === 'email') {
    message = `Dear ${tenant.full_name},\n\nThis is a friendly reminder that your invoice ${invoice.invoice_number} has an outstanding balance of KES ${invoice.balance.toLocaleString()}${overdueNote}.\n\nDue Date: ${invoice.due_date}\nInvoice Total: KES ${invoice.total.toLocaleString()}\nAmount Paid: KES ${invoice.amount_paid.toLocaleString()}\nBalance Due: KES ${invoice.balance.toLocaleString()}\n\nPlease make payment via:\n${landlordPaybill ? `M-Pesa Paybill: ${landlordPaybill}` : 'M-Pesa Paybill: Not configured (contact management)'}\nAccount Number: ${tenant.tenant_account_number}\n\nIf you have already made payment, please disregard this notice.\n\nWarm regards,\n${org ? org.name : 'Property Management'}`;
  } else if (channel === 'whatsapp') {
    message = landlordPaybill
      ? `👋 Hi *${tenant.full_name}*!\n\nThis is a reminder for invoice *${invoice.invoice_number}*${overdueNote}.\n\n💰 *Balance Due:* KES ${invoice.balance.toLocaleString()}\n📅 *Due Date:* ${invoice.due_date}\n\nPay easily via M-Pesa:\n📲 *Paybill:* ${landlordPaybill}\n🔑 *Account:* ${tenant.tenant_account_number}\n\nThank you! 🙏`
      : `👋 Hi *${tenant.full_name}*!\n\nThis is a reminder for invoice *${invoice.invoice_number}*${overdueNote}.\n\n💰 *Balance Due:* KES ${invoice.balance.toLocaleString()}\n📅 *Due Date:* ${invoice.due_date}\n\nM-Pesa Paybill is not configured for this property. Please contact management before making payment.\n🔑 *Account:* ${tenant.tenant_account_number}\n\nThank you! 🙏`;
  }

  const destination = channel === 'email' ? (tenant.email || tenant.phone_number) : tenant.phone_number;

  const notificationService = new NotificationService(null);
  const log = await notificationService.queue({
    organizationId: orgId,
    tenantId: tenant.id,
    channel: channel,
    type: daysOverdue > 0 ? 'overdue_reminder' : 'rent_reminder',
    data: {
      invoice_number: invoice.invoice_number,
      amount: invoice.total,
      balance: invoice.balance,
      due_date: invoice.due_date,
      account_number: tenant.tenant_account_number
    }
  });

  // Mark reminder sent on invoice
  db.update('invoices', invoiceId, {
    last_reminder_sent_at: new Date().toISOString(),
    last_reminder_channel: channel
  });

  db.logAudit(orgId, userId, role, 'reminder_sent', 'invoice', invoiceId, null,
    { channel, destination, message },
    `Payment reminder sent via ${channel}`
  );

  res.json({
    success: true,
    channel,
    log_id: log.id,
    phone: tenant.phone_number,
    email: tenant.email || null,
    tenant_name: tenant.full_name,
    message,
    sent_at: log.sent_at
  });
});

// --- PAYMENTS & LEDGER API ---

// Payments list
app.get('/api/payments', (req, res) => {
  const orgId = req.auth?.organizationId;
  const txs = db.find('transactions', { organization_id: orgId });
  const tenants = db.get('tenants');
  const properties = db.get('properties');
  const units = db.get('units');

  const detailedTxs = txs.map(t => {
    const tenant = tenants.find(te => te.id === t.tenant_id);
    const prop = properties.find(p => p.id === t.property_id);
    const unit = units.find(u => u.id === t.unit_id);
    return {
      ...t,
      tenant_name: tenant ? tenant.full_name : (t.payer_name || 'N/A'),
      property_name: prop ? prop.name : 'N/A',
      unit_code: unit ? unit.unit_code : 'N/A'
    };
  });

  res.json(detailedTxs);
});

// Record manual payment
app.post('/api/payments', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { tenant_id, amount, payment_method, reference_number, transaction_date, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  // Check duplicate reference
  const duplicate = db.findOne('transactions', { reference_number, organization_id: orgId });
  if (duplicate) {
    return res.status(400).json({ error: 'This transaction reference already exists and cannot be posted again.' });
  }

  const tenant = db.findOne('tenants', { id: parseInt(tenant_id), organization_id: orgId });
  if (!tenant) {
    return res.status(400).json({ error: 'Tenant not found.' });
  }

  // Create Transaction
  const transaction = db.insert('transactions', {
    organization_id: orgId,
    tenant_id: tenant.id,
    property_id: tenant.property_id,
    unit_id: tenant.unit_id,
    amount: parseFloat(amount),
    currency: tenant.currency || 'KES',
    transaction_type: 'payment',
    payment_method,
    source: 'manual',
    reference_number,
    account_number: tenant.tenant_account_number,
    payer_name: tenant.full_name,
    payer_phone: tenant.phone_number,
    transaction_date,
    status: 'reconciled',
    raw_payload: 'MANUAL_ENTRY',
    created_by: userId,
    reconciled_by: userId,
    reconciled_at: new Date().toISOString()
  });

  // Allocate payment to unpaid invoices
  let remainingAmount = parseFloat(amount);
  const unpaidInvoices = db.find('invoices', { tenant_id: tenant.id })
    .filter(inv => inv.status === 'issued' || inv.status === 'partially_paid' || inv.status === 'overdue')
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date)); // oldest first

  for (const inv of unpaidInvoices) {
    if (remainingAmount <= 0) break;

    const toAllocate = Math.min(inv.balance, remainingAmount);
    const newPaid = inv.amount_paid + toAllocate;
    const newBal = inv.balance - toAllocate;
    const newStatus = newBal === 0 ? 'paid' : 'partially_paid';

    db.update('invoices', inv.id, {
      amount_paid: newPaid,
      balance: newBal,
      status: newStatus
    });

    db.insert('payment_allocations', {
      organization_id: orgId,
      transaction_id: transaction.id,
      invoice_id: inv.id,
      amount_allocated: toAllocate,
      allocated_by: userId,
      allocated_at: new Date().toISOString()
    });

    remainingAmount -= toAllocate;
  }

  // Overpayment logic
  if (remainingAmount > 0) {
    // Leftover remainingAmount is kept on the transaction as unallocated tenant credit.
    // In MVP, we log it and show it on tenant balance summaries.
    console.log(`Overpayment of KES ${remainingAmount} detected for tenant ${tenant.id}. Kept as credit.`);
  }

  db.logAudit(orgId, userId, role, 'payment_recorded', 'transaction', transaction.id, null, transaction);

  // Send mock payment confirmation log
  const notificationService = new NotificationService(null);
  notificationService.queue({
    organizationId: orgId,
    tenantId: tenant.id,
    channel: 'sms',
    type: 'payment_confirmed',
    data: {
      amount,
      account_number: tenant.tenant_account_number,
      reference: reference_number
    }
  });

  res.status(201).json(transaction);
});

// Reversing transaction (Requires PIN)
app.post('/api/payments/:id/reverse', (req, res) => {
  const orgId = req.auth?.organizationId;
  const txId = parseInt(req.params.id);
  const { pin, reason } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const org = db.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const tx = db.findOne('transactions', { id: txId, organization_id: orgId });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.status === 'reversed') return res.status(400).json({ error: 'Transaction is already reversed.' });

  // Update transaction status
  db.update('transactions', txId, { status: 'reversed' });

  // Reverse invoice updates
  const allocations = db.find('payment_allocations', { transaction_id: txId, organization_id: orgId });
  allocations.forEach(alloc => {
    const inv = db.findOne('invoices', { id: alloc.invoice_id });
    if (inv) {
      const newPaid = Math.max(0, inv.amount_paid - alloc.amount_allocated);
      const newBal = inv.total - newPaid;
      let newStatus = 'issued';
      if (newPaid > 0) newStatus = 'partially_paid';
      if (newPaid === 0 && new Date(inv.due_date) < new Date()) newStatus = 'overdue';

      db.update('invoices', inv.id, {
        amount_paid: newPaid,
        balance: newBal,
        status: newStatus
      });
    }
  });

  // Create reversal log entry in transactions
  const reversalTx = db.insert('transactions', {
    organization_id: orgId,
    tenant_id: tx.tenant_id,
    property_id: tx.property_id,
    unit_id: tx.unit_id,
    amount: -tx.amount,
    currency: tx.currency,
    transaction_type: 'reversal',
    payment_method: tx.payment_method,
    source: 'manual',
    reference_number: `REV-${tx.reference_number}`,
    account_number: tx.account_number,
    payer_name: tx.payer_name,
    payer_phone: tx.payer_phone,
    transaction_date: new Date().toISOString(),
    status: 'reconciled',
    raw_payload: JSON.stringify({ reversed_transaction_id: txId, reason }),
    created_by: userId,
    reconciled_by: userId,
    reconciled_at: new Date().toISOString()
  });

  db.logAudit(orgId, userId, role, 'payment_reversed', 'transaction', txId, tx, reversalTx, `Reversal reason: ${reason}`, 'success');

  res.json({ success: true, message: 'Transaction reversed successfully.' });
});

// --- RECONCILIATION WORKBENCH API ---

// Get unmatched staging rows
app.get('/api/reconciliation/staging', (req, res) => {
  const orgId = req.auth?.organizationId;
  const rows = db.find('reconciliation_staging_rows', { organization_id: orgId });
  res.json(rows);
});

// Sample bank CSV download endpoint
app.get('/api/reconciliation/sample-csv', (req, res) => {
  const csvContent = `Date,Amount,Reference,Account number,Description,Payer name
2026-06-15,45000,KCB-TR-88881,ACC-0010-A1,David Rent,David Kiprop
2026-06-15,30000,KCB-TR-88882,ACC-0010-A2,Rent payment,Alice Wambui
2026-06-16,15000,KCB-TR-88883,ACC-0020-G01,Bedsitter G01,John Mwangi
2026-06-16,10000,KCB-TR-88884,ACC-0010-A2,Partial Payment,Alice Wambui
2026-06-16,5000,KCB-TR-88885,,Cash Deposit,Samuel Nderitu`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sample_bank_statement.csv');
  res.send(csvContent);
});

// CSV Statement Upload
app.post('/api/reconciliation/upload', upload.single('file'), (req, res) => {
  const orgId = req.auth?.organizationId;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const fileContent = fs.readFileSync(req.file.path, 'utf8');

    // Simple line by line CSV parser
    const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'Empty or invalid CSV file.' });
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const rawRows = lines.slice(1).map((line, index) => {
      // Split by comma ignoring commas inside quotes if present (simplified regex for safety)
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());

      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      return { id: index + 1, data: row };
    });

    res.json({
      headers,
      rows: rawRows,
      fileName: req.file.originalname,
      tempPath: req.file.path
    });
  } catch (error) {
    console.error('CSV Parsing error:', error);
    res.status(500).json({ error: 'The file could not be imported. Please check the date, amount, reference, and description columns.' });
  }
});

// Finalize CSV Import & Auto Match
app.post('/api/reconciliation/import-finalize', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { tempPath, fileName, mappings } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (!tempPath || !mappings) {
    return res.status(400).json({ error: 'Missing temporary file path or column mappings.' });
  }

  try {
    const fileContent = fs.readFileSync(tempPath, 'utf8');
    const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1);

    // Create Batch
    const batch = db.insert('reconciliation_batches', {
      organization_id: orgId,
      uploaded_by: userId,
      source_type: 'bank_csv',
      original_file_name: fileName || 'statement.csv',
      status: 'uploaded',
      total_rows: rows.length,
      matched_rows: 0,
      unmatched_rows: 0,
      duplicate_rows: 0,
      invalid_rows: 0
    });

    let probableCount = 0;
    let possibleCount = 0;
    let unmatchedCount = 0;
    let duplicateCount = 0;

    const tenants = db.find('tenants', { organization_id: orgId });
    const units = db.find('units', { organization_id: orgId, deleted_at: null });
    const properties = db.find('properties', { organization_id: orgId, deleted_at: null });
    const invoices = db.find('invoices', { organization_id: orgId }).filter(inv => inv.status !== 'paid' && inv.status !== 'void');

    rows.forEach(line => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
      const rowData = {};
      headers.forEach((header, idx) => {
        rowData[header] = values[idx] || '';
      });

      // Extract mapped values
      const dateVal = rowData[mappings.date];
      const amountVal = parseFloat(rowData[mappings.amount]) || 0;
      const refVal = rowData[mappings.reference];
      const accVal = rowData[mappings.account_number] || '';
      const descVal = rowData[mappings.description] || '';
      const payerVal = rowData[mappings.payer_name] || '';

      // Check duplicates
      const isRefProvided = refVal && String(refVal).trim() !== '';
      const dupLedger = isRefProvided ? db.findOne('transactions', { reference_number: refVal, organization_id: orgId }) : null;
      const dupStaging = isRefProvided ? db.findOne('reconciliation_staging_rows', { reference_number: refVal, organization_id: orgId }) : null;

      if (dupLedger || dupStaging) {
        duplicateCount++;
        db.insert('reconciliation_staging_rows', {
          organization_id: orgId,
          batch_id: batch.id,
          raw_row_data: line,
          transaction_date: dateVal,
          amount: amountVal,
          reference_number: refVal,
          account_number: accVal,
          description: descVal,
          payer_name: payerVal,
          status: 'duplicate',
          error_message: 'Duplicate reference number.'
        });
        return;
      }

      // Safe Deterministic Weighted Match Logic
      let bestTenant = null;
      let bestInvoice = null;
      let maxScore = 0;

      tenants.forEach(tenant => {
        let score = 0;

        // 1. Account number match
        if (accVal && tenant.tenant_account_number) {
          if (tenant.tenant_account_number.toLowerCase() === accVal.toLowerCase()) {
            score += 80;
          }
        }

        // 2. Phone match
        if (tenant.phone_number) {
          const cleanPhone = tenant.phone_number.replace(/\D/g, '');
          if (cleanPhone && cleanPhone.length > 5) {
            if (descVal.includes(cleanPhone) || payerVal.includes(cleanPhone) || accVal.includes(cleanPhone)) {
              score += 70;
            }
          }
        }

        // 3. Name match
        if (payerVal && tenant.full_name) {
          const tenantNameLower = tenant.full_name.toLowerCase();
          const payerValLower = payerVal.toLowerCase();
          if (tenantNameLower === payerValLower || payerValLower.includes(tenantNameLower) || tenantNameLower.includes(payerValLower)) {
            score += 50;
          } else {
            // Check word inclusion
            const tenantWords = tenantNameLower.split(/\s+/).filter(w => w.length > 3);
            const payerWords = payerValLower.split(/\s+/).filter(w => w.length > 3);
            const commonWords = tenantWords.filter(w => payerWords.includes(w));
            if (commonWords.length > 0) {
              score += 25 * commonWords.length;
            }
          }
        }

        // 4. Unit code match
        const unit = units.find(u => u.id === tenant.unit_id);
        if (unit && unit.unit_code) {
          const unitCodeLower = unit.unit_code.toLowerCase();
          const descLower = descVal.toLowerCase();
          if (descLower.includes(unitCodeLower)) {
            score += 40;
          }
        }

        // 5. Property name match
        if (unit) {
          const prop = properties.find(p => p.id === unit.property_id);
          if (prop && prop.name) {
            const propNameLower = prop.name.toLowerCase();
            const descLower = descVal.toLowerCase();
            if (descLower.includes(propNameLower)) {
              score += 20;
            }
          }
        }

        // 6. Rent amount match
        if (tenant.rent_amount && Math.abs(tenant.rent_amount - amountVal) < 0.01) {
          score += 30;
        }

        // 7. Invoice matching
        const tenantInvs = invoices.filter(inv => inv.tenant_id === tenant.id);
        let invoiceMatch = null;
        let invoiceScore = 0;

        tenantInvs.forEach(inv => {
          let invScore = 0;

          // Exact invoice number match in description
          if (inv.invoice_number && descVal.toLowerCase().includes(inv.invoice_number.toLowerCase())) {
            invScore += 100;
          }

          // Balance match
          if (inv.balance && Math.abs(inv.balance - amountVal) < 0.01) {
            invScore += 40;
          }

          // Date proximity
          if (inv.due_date && dateVal) {
            const daysDiff = Math.abs(new Date(inv.due_date) - new Date(dateVal)) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 5) {
              invScore += 20;
            }
          }

          if (invScore > invoiceScore) {
            invoiceScore = invScore;
            invoiceMatch = inv;
          }
        });

        score += invoiceScore;

        if (score > maxScore) {
          maxScore = score;
          bestTenant = tenant;
          bestInvoice = invoiceMatch;
        }
      });

      // Caps the confidence score to 99% for safety
      const confidence = Math.min(Math.round(maxScore), 99);

      let status = 'unmatched';
      // High threshold (probable) >= 70
      // Medium threshold (possible) >= 40
      if (bestTenant && confidence >= 40) {
        status = 'needs_review';
        if (confidence >= 70) {
          probableCount++;
        } else {
          possibleCount++;
        }
      } else {
        unmatchedCount++;
        bestTenant = null;
        bestInvoice = null;
      }

      db.insert('reconciliation_staging_rows', {
        organization_id: orgId,
        batch_id: batch.id,
        raw_row_data: line,
        transaction_date: dateVal,
        amount: amountVal,
        reference_number: refVal,
        account_number: accVal,
        description: descVal,
        payer_name: payerVal,
        status,
        suggested_tenant_id: bestTenant ? bestTenant.id : null,
        suggested_unit_id: bestTenant ? bestTenant.unit_id : null,
        suggested_invoice_id: bestInvoice ? bestInvoice.id : null,
        confidence_score: confidence
      });
    });

    // Update batch status
    db.update('reconciliation_batches', batch.id, {
      status: 'reviewed',
      matched_rows: probableCount + possibleCount,
      unmatched_rows: unmatchedCount,
      duplicate_rows: duplicateCount
    });

    db.logAudit(orgId, userId, role, 'csv_uploaded', 'reconciliation_batch', batch.id, null, null, `Imported CSV statement: ${fileName}`);

    // Delete temp upload file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) { }

    res.json({
      success: true,
      batchId: batch.id,
      summary: {
        total: rows.length,
        probable: probableCount,
        possible: possibleCount,
        unmatched: unmatchedCount,
        duplicates: duplicateCount
      }
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to process and import CSV statement rows.' });
  }
});

// Manual Match / Reconcile Staging Row (Requires PIN)
app.post('/api/reconciliation/match', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { row_id, tenant_id, invoice_id, pin } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const org = db.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const row = db.findOne('reconciliation_staging_rows', { id: parseInt(row_id), organization_id: orgId });
  if (!row) return res.status(404).json({ error: 'Staging row not found.' });

  const tenant = db.findOne('tenants', { id: parseInt(tenant_id), organization_id: orgId });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  // 1. Create Ledger Transaction
  const transaction = db.insert('transactions', {
    organization_id: orgId,
    tenant_id: tenant.id,
    property_id: tenant.property_id,
    unit_id: tenant.unit_id,
    amount: row.amount,
    currency: tenant.currency || 'KES',
    transaction_type: 'payment',
    payment_method: 'bank',
    source: 'bank_csv',
    reference_number: row.reference_number,
    account_number: row.account_number || tenant.tenant_account_number,
    payer_name: row.payer_name || tenant.full_name,
    payer_phone: tenant.phone_number,
    transaction_date: row.transaction_date,
    status: 'reconciled',
    raw_payload: row.raw_row_data,
    created_by: userId,
    reconciled_by: userId,
    reconciled_at: new Date().toISOString()
  });

  // 2. Allocate payment to invoice(s)
  let remainingAmount = row.amount;

  if (invoice_id) {
    const inv = db.findOne('invoices', { id: parseInt(invoice_id), tenant_id: tenant.id });
    if (inv) {
      const toAllocate = Math.min(inv.balance, remainingAmount);
      db.update('invoices', inv.id, {
        amount_paid: inv.amount_paid + toAllocate,
        balance: inv.balance - toAllocate,
        status: (inv.balance - toAllocate) === 0 ? 'paid' : 'partially_paid'
      });
      db.insert('payment_allocations', {
        organization_id: orgId,
        transaction_id: transaction.id,
        invoice_id: inv.id,
        amount_allocated: toAllocate,
        allocated_by: userId,
        allocated_at: new Date().toISOString()
      });
      remainingAmount -= toAllocate;
    }
  }

  // Allocate remaining to any other outstanding invoices
  if (remainingAmount > 0) {
    const unpaid = db.find('invoices', { tenant_id: tenant.id })
      .filter(inv => inv.status === 'issued' || inv.status === 'partially_paid' || inv.status === 'overdue')
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    for (const inv of unpaid) {
      if (remainingAmount <= 0) break;
      const toAllocate = Math.min(inv.balance, remainingAmount);
      db.update('invoices', inv.id, {
        amount_paid: inv.amount_paid + toAllocate,
        balance: inv.balance - toAllocate,
        status: (inv.balance - toAllocate) === 0 ? 'paid' : 'partially_paid'
      });
      db.insert('payment_allocations', {
        organization_id: orgId,
        transaction_id: transaction.id,
        invoice_id: inv.id,
        amount_allocated: toAllocate,
        allocated_by: userId,
        allocated_at: new Date().toISOString()
      });
      remainingAmount -= toAllocate;
    }
  }

  // 3. Mark row as reconciled
  db.update('reconciliation_staging_rows', row.id, {
    status: 'reconciled',
    matched_transaction_id: transaction.id,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  });

  db.logAudit(orgId, userId, role, 'csv_row_matched', 'reconciliation_staging_rows', row.id, null, transaction, `Manually matched transaction ref ${row.reference_number} to tenant ${tenant.full_name}`, 'success');

  // SMS Confirmation
  const notificationService = new NotificationService(null);
  notificationService.queue({
    organizationId: orgId,
    tenantId: tenant.id,
    channel: 'sms',
    type: 'payment_confirmed',
    data: {
      amount: row.amount,
      account_number: tenant.tenant_account_number,
      reference: row.reference_number
    }
  });

  res.json({ success: true, transactionId: transaction.id });
});

// Ignore row
app.post('/api/reconciliation/ignore', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { row_id } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const row = db.findOne('reconciliation_staging_rows', { id: parseInt(row_id), organization_id: orgId });
  if (!row) return res.status(404).json({ error: 'Staging row not found.' });

  let newStatus = 'ignored';
  let auditAction = 'csv_row_ignored';
  let auditMsg = `Ignored statement row: ${row_id}`;

  if (row.status === 'ignored' || row.status === 'duplicate') {
    // Restore
    newStatus = (row.suggested_tenant_id && row.confidence_score >= 40) ? 'needs_review' : 'unmatched';
    auditAction = 'csv_row_restored';
    auditMsg = `Restored statement row: ${row_id} to ${newStatus}`;
  }

  const updated = db.update('reconciliation_staging_rows', row.id, {
    status: newStatus,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  });

  db.logAudit(orgId, userId, role, auditAction, 'reconciliation_staging_rows', row_id, null, null, auditMsg);
  res.json({ success: true });
});

// Webhook incoming payment endpoint (M-Pesa callback simulation)
app.post('/api/webhooks/payment', (req, res) => {
  // Simulates MPesa Paybill callback format
  const { TransID, TransAmount, BillRefNumber, MSISDN, FirstName, MiddleName, LastName } = req.body;

  if (!TransID || !TransAmount) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  // We assume webhook belongs to the demo organization (id = 1) for MVP simulation.
  // In production, organization_id is determined by the paybill shortcode / configuration mapping.
  const orgId = 1;
  const amount = parseFloat(TransAmount);
  const payerName = `${FirstName || ''} ${LastName || ''}`.trim() || 'M-Pesa Payer';

  // Check duplicate reference
  const duplicate = db.findOne('transactions', { reference_number: TransID, organization_id: orgId });
  if (duplicate) {
    db.logAudit(orgId, null, 'system', 'webhook_duplicate_blocked', 'webhook', null, null, null, `Blocked duplicate webhook transaction ${TransID}`);
    return res.status(200).json({ ResultCode: 1, ResultDesc: 'Duplicate Transaction' });
  }

  // Auto matching engine priority
  const tenants = db.find('tenants', { organization_id: orgId });
  const invoices = db.find('invoices', { organization_id: orgId }).filter(inv => inv.status !== 'paid' && inv.status !== 'void');
  let matchedTenant = null;
  let matchedInvoice = null;

  // Normalize ref number
  const cleanRef = BillRefNumber ? BillRefNumber.trim().toUpperCase() : '';

  // Priority 1: Exact invoice number match
  if (cleanRef.startsWith('INV-')) {
    matchedInvoice = invoices.find(inv => inv.invoice_number === cleanRef);
    if (matchedInvoice) {
      matchedTenant = tenants.find(t => t.id === matchedInvoice.tenant_id);
    }
  }

  // Priority 2: Exact tenant account number match
  if (!matchedTenant && cleanRef.startsWith('ACC-')) {
    matchedTenant = tenants.find(t => t.tenant_account_number.toUpperCase() === cleanRef);
  }

  // Priority 3: Exact unit code match
  if (!matchedTenant && cleanRef) {
    matchedTenant = tenants.find(t => {
      const unit = db.findOne('units', { id: t.unit_id });
      return unit && unit.unit_code.toUpperCase() === cleanRef;
    });
  }

  // Priority 4: Payer phone number match
  if (!matchedTenant && MSISDN) {
    // Normalize format e.g. 254712345678 or +254...
    const cleanPhone = MSISDN.replace('+', '');
    matchedTenant = tenants.find(t => t.phone_number.includes(cleanPhone) || cleanPhone.includes(t.phone_number.replace('+', '')));
  }

  // If found tenant but not specific invoice, get oldest unpaid invoice
  if (matchedTenant && !matchedInvoice) {
    const tenantInvs = invoices.filter(inv => inv.tenant_id === matchedTenant.id);
    if (tenantInvs.length > 0) {
      matchedInvoice = tenantInvs.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
    }
  }

  if (matchedTenant) {
    // 1. Create reconciled ledger transaction
    const transaction = db.insert('transactions', {
      organization_id: orgId,
      tenant_id: matchedTenant.id,
      property_id: matchedTenant.property_id,
      unit_id: matchedTenant.unit_id,
      amount,
      currency: 'KES',
      transaction_type: 'payment',
      payment_method: 'mpesa',
      source: 'mpesa_callback',
      reference_number: TransID,
      account_number: BillRefNumber || matchedTenant.tenant_account_number,
      payer_name: payerName,
      payer_phone: MSISDN || matchedTenant.phone_number,
      transaction_date: new Date().toISOString(),
      status: 'reconciled',
      raw_payload: JSON.stringify(req.body),
      created_by: null,
      reconciled_by: null,
      reconciled_at: new Date().toISOString()
    });

    // 2. Allocate payment
    let remainingAmount = amount;
    if (matchedInvoice) {
      const toAllocate = Math.min(matchedInvoice.balance, remainingAmount);
      db.update('invoices', matchedInvoice.id, {
        amount_paid: matchedInvoice.amount_paid + toAllocate,
        balance: matchedInvoice.balance - toAllocate,
        status: (matchedInvoice.balance - toAllocate) === 0 ? 'paid' : 'partially_paid'
      });
      db.insert('payment_allocations', {
        organization_id: orgId,
        transaction_id: transaction.id,
        invoice_id: matchedInvoice.id,
        amount_allocated: toAllocate,
        allocated_by: null,
        allocated_at: new Date().toISOString()
      });
      remainingAmount -= toAllocate;
    }

    if (remainingAmount > 0) {
      const unpaid = invoices.filter(inv => inv.tenant_id === matchedTenant.id && inv.id !== (matchedInvoice ? matchedInvoice.id : 0))
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

      for (const inv of unpaid) {
        if (remainingAmount <= 0) break;
        const toAllocate = Math.min(inv.balance, remainingAmount);
        db.update('invoices', inv.id, {
          amount_paid: inv.amount_paid + toAllocate,
          balance: inv.balance - toAllocate,
          status: (inv.balance - toAllocate) === 0 ? 'paid' : 'partially_paid'
        });
        db.insert('payment_allocations', {
          organization_id: orgId,
          transaction_id: transaction.id,
          invoice_id: inv.id,
          amount_allocated: toAllocate,
          allocated_by: null,
          allocated_at: new Date().toISOString()
        });
        remainingAmount -= toAllocate;
      }
    }

    db.logAudit(orgId, null, 'system', 'webhook_auto_matched', 'transaction', transaction.id, null, transaction, `Webhook auto-matched ref ${TransID} to tenant ${matchedTenant.full_name}`);

    // Send confirmation SMS
    const notificationService = new NotificationService(null);
    notificationService.queue({
      organizationId: orgId,
      tenantId: matchedTenant.id,
      channel: 'sms',
      type: 'payment_confirmed',
      data: {
        amount,
        account_number: matchedTenant.tenant_account_number,
        reference: TransID
      }
    });

  } else {
    // Unmatched: Send to reconciliation staging rows
    const stagingRow = db.insert('reconciliation_staging_rows', {
      organization_id: orgId,
      batch_id: null,
      raw_row_data: JSON.stringify(req.body),
      transaction_date: new Date().toISOString(),
      amount,
      reference_number: TransID,
      account_number: BillRefNumber || '',
      description: `M-Pesa Webhook Payment from ${MSISDN || 'unknown'}`,
      payer_name: payerName,
      payer_phone: MSISDN || '',
      status: 'unmatched',
      error_message: 'Auto-matching failed: no matching account, invoice or phone number.'
    });

    db.logAudit(orgId, null, 'system', 'webhook_unmatched', 'reconciliation_staging_rows', stagingRow.id, null, null, `Webhook payment ${TransID} unmatched. Sent to staging.`);

    // Alert Notification to Landlord
    const notificationService = new NotificationService(null);
    notificationService.queue({
      organizationId: orgId,
      recipientUserId: 2, // Landlord Maina Kamau
      channel: 'in_app',
      type: 'unmatched_payment_alert',
      data: {
        amount,
        payer_name: payerName,
        phone_number: MSISDN,
        reference: TransID
      }
    });
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accept Service Success' });
});

// --- METER READINGS MODULE ---

app.get('/api/meter-readings', (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  let readings = db.find('meter_readings', { organization_id: orgId });

  // Caretaker restrictions
  if (role === 'caretaker') {
    const assignments = db.find('staff_assignments', { caretaker_user_id: userId, status: 'active' });
    const assignmentIds = assignments.map(a => a.id);
    const assignedPropLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const assignedPropIds = assignedPropLinks.map(link => link.property_id);

    readings = readings.filter(r => assignedPropIds.includes(r.property_id));
  }

  const properties = db.get('properties');
  const units = db.get('units');
  const tenants = db.get('tenants');

  const detailed = readings.map(r => {
    const prop = properties.find(p => p.id === r.property_id);
    const unit = units.find(u => u.id === r.unit_id);
    const tenant = tenants.find(t => t.id === r.tenant_id);
    return {
      ...r,
      property_name: prop ? prop.name : 'Unknown Property',
      unit_code: unit ? unit.unit_code : 'Unknown Unit',
      tenant_name: tenant ? tenant.full_name : 'Vacant'
    };
  });

  res.json(detailed);
});

// Submit reading (Caretaker)
app.post('/api/meter-readings', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { property_id, unit_id, meter_type, current_reading, notes } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const unit = db.findOne('units', { id: parseInt(unit_id), property_id: parseInt(property_id) });
  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  // Get active tenant
  const activeTenant = db.findOne('tenants', { unit_id: unit.id, status: 'active' });

  // Get previous reading
  const previousReadings = db.find('meter_readings', { unit_id: unit.id, meter_type })
    .filter(r => r.status === 'approved' || r.status === 'reviewed' || r.status === 'billed')
    .sort((a, b) => new Date(b.reading_date) - new Date(a.reading_date));

  const prevReading = previousReadings.length > 0 ? previousReadings[0].current_reading : 0;
  const usage = parseInt(current_reading) - prevReading;

  if (usage < 0) {
    return res.status(400).json({ error: 'Current reading cannot be lower than previous reading.' });
  }

  const reading = db.insert('meter_readings', {
    organization_id: orgId,
    property_id: parseInt(property_id),
    unit_id: parseInt(unit_id),
    tenant_id: activeTenant ? activeTenant.id : null,
    meter_type,
    previous_reading: prevReading,
    current_reading: parseInt(current_reading),
    usage,
    reading_date: new Date().toISOString().split('T')[0],
    submitted_by: userId,
    reviewed_by: null,
    status: 'submitted',
    notes: notes || ''
  });

  db.logAudit(orgId, userId, role, 'meter_reading_submitted', 'meter_reading', reading.id, null, reading);

  // Notify Landlord
  db.insert('notifications', {
    organization_id: orgId,
    user_id: 2, // Landlord
    type: 'METER_READING_SUBMITTED',
    priority: 'actionable',
    title: 'New Meter Reading Submitted',
    body: `Caretaker submitted a ${meter_type} reading of ${current_reading} for Unit ${unit.unit_code} (${propName(property_id)}).`,
    action_url: '/meter-readings',
    is_read: false
  });

  res.status(201).json(reading);
});

function propName(id) {
  const p = db.findOne('properties', { id: parseInt(id) });
  return p ? p.name : '';
}

// Approve/Reject meter reading (Landlord)
app.post('/api/meter-readings/:id/review', (req, res) => {
  const orgId = req.auth?.organizationId;
  const readingId = parseInt(req.params.id);
  const { status, action_bill } = req.body; // 'approved', 'rejected'
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const reading = db.findOne('meter_readings', { id: readingId, organization_id: orgId });
  if (!reading) return res.status(404).json({ error: 'Reading not found' });

  db.update('meter_readings', readingId, {
    status,
    reviewed_by: userId
  });

  db.logAudit(orgId, userId, role, `meter_reading_${status}`, 'meter_reading', readingId, reading, { status });

  // Generate invoice item automatically if approved and action_bill is true
  if (status === 'approved' && action_bill && reading.tenant_id) {
    // Look up rate from service_rates table (fall back to defaults if not configured)
    const rateRecord = db.findOne('service_rates', { organization_id: orgId, service_type: reading.meter_type, is_active: true });
    const rate = rateRecord ? rateRecord.rate : (reading.meter_type === 'water' ? 150 : 25);
    const cost = reading.usage * rate;
    const tenant = db.findOne('tenants', { id: reading.tenant_id });
    const unit = db.findOne('units', { id: reading.unit_id });

    // Look for an existing draft rent invoice for this tenant
    let invoice = db.find('invoices', { tenant_id: reading.tenant_id, invoice_type: 'rent' })
      .filter(inv => inv.status === 'draft')[0];

    // If no draft, try looking for an issued rent invoice
    if (!invoice) {
      invoice = db.find('invoices', { tenant_id: reading.tenant_id, invoice_type: 'rent' })
        .filter(inv => inv.status === 'issued')[0];
    }

    if (invoice) {
      // Append line item to existing monthly rent invoice
      db.insert('invoice_items', {
        organization_id: orgId,
        invoice_id: invoice.id,
        description: `${reading.meter_type.toUpperCase()} Billing (${reading.usage} units)`,
        item_type: reading.meter_type,
        quantity: reading.usage,
        unit_price: rate,
        total: cost
      });

      // Update invoice subtotals and balances
      const newSubtotal = invoice.subtotal + cost;
      const newTotal = invoice.total + cost;
      const newBalance = invoice.balance + cost;

      db.update('invoices', invoice.id, {
        subtotal: newSubtotal,
        total: newTotal,
        balance: newBalance
      });

      db.update('meter_readings', readingId, { status: 'billed' });
      db.logAudit(orgId, userId, role, 'utility_appended_to_rent_invoice', 'invoice', invoice.id, null, { cost });
    } else {
      // No existing rent invoice, create a consolidated monthly bill
      const randNum = Math.floor(1000 + Math.random() * 9000);
      const dueDateVal = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const newInvoice = db.insert('invoices', {
        organization_id: orgId,
        property_id: reading.property_id,
        unit_id: reading.unit_id,
        tenant_id: reading.tenant_id,
        invoice_number: `INV-RENT-${randNum}`,
        invoice_type: 'rent',
        status: 'draft',
        issue_date: new Date().toISOString().split('T')[0],
        due_date: dueDateVal,
        currency: 'KES',
        subtotal: tenant.rent_amount,
        total: tenant.rent_amount,
        amount_paid: 0,
        balance: tenant.rent_amount,
        notes: 'Monthly consolidated rent & utility invoice',
        created_by: userId
      });

      // Insert Rent Item
      db.insert('invoice_items', {
        organization_id: orgId,
        invoice_id: newInvoice.id,
        description: `Monthly Rent - Unit ${unit ? unit.unit_code : 'N/A'}`,
        item_type: 'rent',
        quantity: 1,
        unit_price: tenant.rent_amount,
        total: tenant.rent_amount
      });

      // Insert Water/Utility Item
      db.insert('invoice_items', {
        organization_id: orgId,
        invoice_id: newInvoice.id,
        description: `${reading.meter_type.toUpperCase()} Billing (${reading.usage} units)`,
        item_type: reading.meter_type,
        quantity: reading.usage,
        unit_price: rate,
        total: cost
      });

      // Recalculate totals
      const totalAmount = tenant.rent_amount + cost;
      db.update('invoices', newInvoice.id, {
        subtotal: totalAmount,
        total: totalAmount,
        balance: totalAmount
      });

      db.update('meter_readings', readingId, { status: 'billed' });
      db.logAudit(orgId, userId, role, 'rent_invoice_created_with_utility', 'invoice', newInvoice.id, null, newInvoice);
    }
  }

  res.json({ success: true });
});

// --- MESSAGING & COMMUNICATIONS ---

// Get messages chat list
app.get('/api/messages', (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const messages = db.find('internal_messages', { organization_id: orgId });
  const users = db.get('users');

  // Filter messages belonging to the current user (either sender or recipient)
  const userMessages = messages.filter(msg => msg.sender_user_id === userId || msg.recipient_user_id === userId);

  // Group chats by partner id
  const chatsMap = {};
  userMessages.forEach(msg => {
    const partnerId = msg.sender_user_id === userId ? msg.recipient_user_id : msg.sender_user_id;
    if (!chatsMap[partnerId]) {
      const partner = users.find(u => u.id === partnerId);
      chatsMap[partnerId] = {
        partner_id: partnerId,
        partner_name: partner ? partner.name : 'Unknown User',
        last_message: msg.message_body,
        last_message_time: msg.created_at,
        unread_count: (!msg.is_read && msg.recipient_user_id === userId) ? 1 : 0,
        messages: []
      };
    } else {
      if (!msg.is_read && msg.recipient_user_id === userId) {
        chatsMap[partnerId].unread_count++;
      }
      // Keep track of the latest message
      if (new Date(msg.created_at) > new Date(chatsMap[partnerId].last_message_time)) {
        chatsMap[partnerId].last_message = msg.message_body;
        chatsMap[partnerId].last_message_time = msg.created_at;
      }
    }
    chatsMap[partnerId].messages.push(msg);
  });

  // Sort messages in each chat
  Object.keys(chatsMap).forEach(key => {
    chatsMap[key].messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  res.json(Object.values(chatsMap));
});

// Send internal message
app.post('/api/messages', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { recipient_user_id, message_body, property_id, unit_id } = req.body;
  const userId = req.auth?.userId;

  const message = db.insert('internal_messages', {
    organization_id: orgId,
    sender_user_id: userId,
    recipient_user_id: parseInt(recipient_user_id),
    property_id: property_id ? parseInt(property_id) : null,
    unit_id: unit_id ? parseInt(unit_id) : null,
    message_body,
    is_read: false,
    read_at: null
  });

  res.status(201).json(message);
});

// Mark messages as read
app.post('/api/messages/read', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { partner_id } = req.body;
  const userId = req.auth?.userId;

  const messages = db.find('internal_messages', { organization_id: orgId, recipient_user_id: userId, sender_user_id: parseInt(partner_id), is_read: false });
  messages.forEach(msg => {
    db.update('internal_messages', msg.id, { is_read: true, read_at: new Date().toISOString() });
  });

  res.json({ success: true });
});

// --- SETTINGS, INTEGRATIONS, AUDIT & ARCHIVE ---

// Get Service Billing Rates
app.get('/api/settings/service-rates', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const activeDb = pgDb || db;
  let rates = await activeDb.find('service_rates', { organization_id: orgId });

  // If org has no rates yet (e.g. migrated existing db), return defaults
  if (rates.length === 0) {
    const defaults = [
      { id: null, organization_id: orgId, service_type: 'water', label: 'Water', rate_type: 'per_unit', unit_label: 'unit', rate: 150, currency: 'KES', is_active: true },
      { id: null, organization_id: orgId, service_type: 'electricity', label: 'Electricity', rate_type: 'per_unit', unit_label: 'unit', rate: 25, currency: 'KES', is_active: true },
      { id: null, organization_id: orgId, service_type: 'garbage', label: 'Garbage Collection', rate_type: 'monthly_flat', unit_label: 'month', rate: 500, currency: 'KES', is_active: true },
      { id: null, organization_id: orgId, service_type: 'security', label: 'Security Levy', rate_type: 'monthly_flat', unit_label: 'month', rate: 1000, currency: 'KES', is_active: true }
    ];
    return res.json(defaults);
  }

  res.json(rates);
});

// Update / Upsert Service Billing Rates
app.put('/api/settings/service-rates', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { rates } = req.body; // Array of { service_type, label, rate, rate_type, unit_label, is_active }

  if (!Array.isArray(rates)) {
    return res.status(400).json({ error: 'rates must be an array.' });
  }

  const activeDb = pgDb || db;
  const saved = await Promise.all(rates.map(async rateData => {
    const existing = await activeDb.findOne('service_rates', { organization_id: orgId, service_type: rateData.service_type });
    if (existing) {
      const updated = await activeDb.update('service_rates', existing.id, {
        label: rateData.label,
        rate: parseFloat(rateData.rate),
        rate_type: rateData.rate_type,
        unit_label: rateData.unit_label,
        is_active: rateData.is_active !== false
      });
      return updated[0] || updated;
    } else {
      return await activeDb.insert('service_rates', {
        organization_id: orgId,
        service_type: rateData.service_type,
        label: rateData.label,
        rate_type: rateData.rate_type || 'per_unit',
        unit_label: rateData.unit_label || 'unit',
        rate: parseFloat(rateData.rate),
        currency: 'KES',
        is_active: rateData.is_active !== false
      });
    }
  }));

  await activeDb.logAudit(orgId, userId, role, 'service_rates_updated', 'service_rates', null, null, rates, 'Landlord updated billing rates');
  res.json(saved);
});

// Delete a custom service rate (non-system services only)
app.delete('/api/settings/service-rates/:id', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const rateId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const activeDb = pgDb || db;
  const rate = await activeDb.findOne('service_rates', { id: rateId, organization_id: orgId });
  if (!rate) return res.status(404).json({ error: 'Service rate not found.' });

  // Protect system-defined services from deletion
  const systemTypes = ['water', 'electricity', 'garbage', 'security'];
  if (systemTypes.includes(rate.service_type)) {
    return res.status(400).json({ error: 'System service rates cannot be deleted. You may disable them instead.' });
  }

  await activeDb.delete('service_rates', { id: rateId, organization_id: orgId });
  await activeDb.logAudit(orgId, userId, role, 'service_rate_deleted', 'service_rates', rateId, rate, null, `Deleted custom service: ${rate.label}`);

  res.json({ success: true });
});

// Integrations list
app.get('/api/integrations', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const activeDb = pgDb || db;
  const list = await activeDb.find('organization_integrations', { organization_id: orgId });
  res.json(list);
});

// Save integration connection
app.post('/api/integrations', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const { provider_type, provider_name, environment, config_json } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  // Encrypt simulation: Mask credentials
  const maskedConfig = {};
  for (const key in config_json) {
    maskedConfig[key] = config_json[key].length > 4 ? config_json[key].substring(0, 2) + '********' : '********';
  }

  const activeDb = pgDb || db;
  const existing = await activeDb.findOne('organization_integrations', { provider_type, organization_id: orgId });
  let integration;

  if (existing) {
    const updated = await activeDb.update('organization_integrations', existing.id, {
      provider_name,
      environment,
      config_json_encrypted: JSON.stringify(maskedConfig),
      status: 'ready',
      updated_at: new Date().toISOString()
    });
    integration = updated[0] || updated;
  } else {
    integration = await activeDb.insert('organization_integrations', {
      organization_id: orgId,
      provider_type,
      provider_name,
      environment,
      config_json_encrypted: JSON.stringify(maskedConfig),
      callback_url: provider_type === 'mpesa' ? 'http://localhost:5000/api/webhooks/payment' : '',
      is_active: true,
      status: 'ready'
    });
  }

  await activeDb.logAudit(orgId, userId, role, 'integration_added', 'organization_integrations', integration.id, existing, integration);
  res.json(integration);
});

// Test Connection
app.post('/api/integrations/:id/test', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const integrationId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const activeDb = pgDb || db;
  const integration = await activeDb.findOne('organization_integrations', { id: integrationId, organization_id: orgId });
  if (!integration) return res.status(404).json({ error: 'Integration not found.' });

  // Simulate test connection
  const success = Math.random() > 0.05; // 95% success rate for simulation

  const testLog = await activeDb.insert('integration_test_logs', {
    organization_id: orgId,
    integration_id: integrationId,
    tested_by: userId,
    status: success ? 'success' : 'failed',
    response_summary: success ? '200 OK Connection established. Webhook responds.' : '504 Gateway Timeout connecting to Sandbox provider API.',
    error_message: success ? null : 'Sandbox endpoint did not return validation challenge.'
  });

  await activeDb.update('organization_integrations', integrationId, {
    status: success ? 'ready' : 'test_failed',
    last_tested_at: new Date().toISOString()
  });

  res.json(testLog);
});

// Test SMS
app.post('/api/integrations/:id/test-sms', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const integrationId = parseInt(req.params.id);
  const { phone_number } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  if (!phone_number) {
    return res.status(400).json({ error: 'phone_number is required.' });
  }

  const activeDb = pgDb || db;
  const integration = await activeDb.findOne('organization_integrations', { id: integrationId, organization_id: orgId });
  if (!integration) return res.status(404).json({ error: 'Integration not found.' });

  if (integration.provider_type !== 'sms' || integration.provider_name !== 'Mobitech') {
    return res.status(400).json({ error: 'This action is only supported for Mobitech SMS integration.' });
  }

  // Normalize number
  let cleaned = phone_number.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }
  if (cleaned.length === 9 && cleaned.startsWith('7')) {
    cleaned = '254' + cleaned;
  }

  const success = true;
  const summary = `Mock Send Success — Simulated test SMS sent to ${cleaned}.`;

  const testLog = await activeDb.insert('integration_test_logs', {
    organization_id: orgId,
    integration_id: integrationId,
    tested_by: userId,
    status: 'success',
    response_summary: summary,
    error_message: null
  });

  await activeDb.update('organization_integrations', integrationId, {
    status: 'ready',
    last_tested_at: new Date().toISOString()
  });

  await activeDb.logAudit(
    orgId, userId, role,
    'integration_test_passed',
    'organization_integrations',
    integrationId,
    { status: integration.status },
    { status: 'ready', test_log_id: testLog.id },
    `Mobitech test SMS passed for recipient ${cleaned}.`
  );

  res.json({
    success: true,
    message: summary,
    test_log_id: testLog.id,
    new_status: 'ready'
  });
});

// Delete credentials (Requires PIN)
app.post('/api/integrations/:id/delete', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const integrationId = parseInt(req.params.id);
  const { pin } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const activeDb = pgDb || db;
  const org = await activeDb.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const integration = await activeDb.findOne('organization_integrations', { id: integrationId, organization_id: orgId });
  if (!integration) return res.status(404).json({ error: 'Integration not found.' });

  await activeDb.delete('organization_integrations', { id: integrationId, organization_id: orgId });

  await activeDb.logAudit(orgId, userId, role, 'api_credential_deleted', 'organization_integrations', integrationId, integration, null, 'Deleted API keys from dashboard', 'success');

  res.json({ success: true, message: 'Credentials deleted successfully.' });
});

// Get Audit Logs (Settings)
app.get('/api/settings/audit-logs', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'You do not have permission to access this financial feature.' });
  }

  const activeDb = pgDb || db;
  const logs = await activeDb.find('audit_logs', { organization_id: orgId });
  const users = await activeDb.get('users');

  const detailedLogs = logs.map(l => {
    const user = users.find(u => u.id === l.actor_user_id);
    return {
      ...l,
      actor_name: user ? user.name : 'System Webhook / Admin'
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(detailedLogs);
});

// Settings info & setup readiness
app.get('/api/settings/readiness', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const activeDb = pgDb || db;
  const org = await activeDb.findOne('organizations', { id: orgId });

  if (!org) return res.status(404).json({ error: 'Org not found' });

  const props = await activeDb.find('properties', { organization_id: orgId, deleted_at: null });
  const units = await activeDb.find('units', { organization_id: orgId, deleted_at: null });
  const tenants = await activeDb.find('tenants', { organization_id: orgId, deleted_at: null });
  const integrations = await activeDb.find('organization_integrations', { organization_id: orgId });
  const pinSet = org.security_pin_hash ? true : false;

  const checklist = {
    profile_complete: (org.name && org.phone_number && org.email && org.country && org.billing_currency) ? true : false,
    pin_created: pinSet,
    property_created: props.length > 0,
    unit_created: units.length > 0,
    tenant_added: tenants.length > 0,
    sms_configured: integrations.some(i => i.provider_type === 'sms' && i.status === 'ready'),
    mpesa_configured: integrations.some(i => i.provider_type === 'mpesa' && i.status === 'ready'),
    saas_billing_active: org.subscription_status === 'active'
  };

  res.json({
    checklist,
    is_ready: Object.values(checklist).every(v => v === true)
  });
});

// Email configuration summary for landlord settings
app.get('/api/settings/email', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const activeDb = pgDb || db;

  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (role === 'caretaker') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Caretakers cannot manage email settings.' });
  }

  const organization = await activeDb.findOne('organizations', { id: orgId });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  const customIntegration = await activeDb.findOne('organization_integrations', {
    organization_id: orgId,
    provider_type: 'email'
  });
  const platformSettings = await activeDb.findOne('platform_billing_settings', { id: 1 });

  const mode = organization.email_delivery_mode || EMAIL_MODES.PLATFORM;
  const customConfig = customIntegration?.config_json_encrypted ? decryptConfig(customIntegration.config_json_encrypted) : {};
  const customSmtp = customIntegration
    ? {
        id: customIntegration.id,
        status: customIntegration.status,
        last_tested_at: customIntegration.last_tested_at,
        has_credentials: Boolean(customIntegration.config_json_encrypted),
        config_masked: customIntegration.config_json_encrypted ? maskSmtpConfig(normalizeSmtpConfig(customConfig)) : {}
      }
    : null;

  const platformEmail = platformSettings
    ? {
        status: platformSettings.smtp_status || 'not_configured',
        last_tested_at: platformSettings.smtp_last_tested_at || null,
        has_credentials: Boolean(platformSettings.smtp_config_encrypted)
      }
    : {
        status: 'not_configured',
        last_tested_at: null,
        has_credentials: false
      };

  res.json({
    email_delivery_mode: mode,
    email_status: organization.email_status || (mode === EMAIL_MODES.CUSTOM ? customIntegration?.status || 'not_configured' : platformEmail.status),
    custom_smtp: customSmtp,
    platform_email: platformEmail
  });
});

// Landlord email mode selector
app.put('/api/settings/email-mode', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const userId = req.auth?.userId;
  const role = req.auth?.role;
  const { mode } = req.body || {};
  const activeDb = pgDb || db;

  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
  if (role === 'caretaker') {
    return res.status(403).json({ error: 'ACCESS_DENIED', message: 'Caretakers cannot manage email settings.' });
  }
  if (![EMAIL_MODES.PLATFORM, EMAIL_MODES.CUSTOM].includes(mode)) {
    return res.status(400).json({ error: 'Invalid email mode.' });
  }

  const org = await activeDb.findOne('organizations', { id: orgId });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  await activeDb.update('organizations', orgId, {
    email_delivery_mode: mode
  });

  const updatedOrg = await activeDb.findOne('organizations', { id: orgId });
  await activeDb.logAudit(
    orgId,
    userId,
    role,
    'landlord_email_mode_changed',
    'organizations',
    orgId,
    { email_delivery_mode: org.email_delivery_mode || EMAIL_MODES.PLATFORM },
    { email_delivery_mode: mode },
    `Landlord email mode changed to ${mode}.`
  );

  res.json({ organization: updatedOrg });
});

function defaultPlatformBillingSettingsRow() {
  return {
    id: 1,
    country: 'Kenya',
    currency: 'KES',
    price_per_active_tenant: 200,
    grace_period_days: 7,
    is_default: true,
    mpesa_shortcode: '174379',
    smtp_config_encrypted: null,
    smtp_status: 'not_configured',
    smtp_last_tested_at: null,
    smtp_last_error: null,
    sms_provider: null,
    sms_api_url: null,
    sms_config_encrypted: null,
    sms_sender_id: 'SMARTLANDY',
    sms_sender_id_type: 'transactional',
    sms_sender_approval_status: 'pending',
    sms_default_country_code: '+254',
    sms_status: 'not_configured',
    sms_last_tested_at: null,
    sms_last_error: null
  };
}

function platformEmailResponseFromSettings(settings) {
  if (!settings) {
    return {
      status: 'not_configured',
      last_tested_at: null,
      config_masked: {},
      has_credentials: false
    };
  }

  const config = settings.smtp_config_encrypted
    ? normalizeSmtpConfig(decryptConfig(settings.smtp_config_encrypted))
    : {};

  return {
    status: settings.smtp_status || 'not_configured',
    last_tested_at: settings.smtp_last_tested_at || null,
    smtp_last_error: settings.smtp_last_error || null,
    config_masked: settings.smtp_config_encrypted ? maskSmtpConfig(config) : {},
    has_credentials: Boolean(settings.smtp_config_encrypted)
  };
}

function platformSmsResponseFromSettings(settings) {
  if (!settings) {
    const readiness = buildSmsReadinessChecklist({
      provider: '',
      api_url: '',
      config: {},
      sender_id: 'SMARTLANDY',
      sender_approval_status: 'pending',
      default_country_code: '+254',
      pricing: {}
    });
    return {
      provider: '',
      provider_key: '',
      provider_profile: null,
      api_url: '',
      sender_id: 'SMARTLANDY',
      sender_id_type: 'transactional',
      sender_approval_status: 'pending',
      default_country_code: '+254',
      status: 'not_configured',
      last_tested_at: null,
      sms_last_error: null,
      sms_billing_enabled: false,
      default_sms_sell_price: '0.0000',
      default_sms_provider_cost: '0.0000',
      sms_currency: 'KES',
      sms_free_monthly_allowance: 0,
      sms_markup_strategy: 'fixed',
      config_masked: {},
      has_credentials: false,
      readiness
    };
  }

  const config = settings.sms_config_encrypted
    ? normalizeSmsConfig(decryptConfig(settings.sms_config_encrypted))
    : {};
  const providerKey = normalizeProviderKey(settings.sms_provider || '');
  const readiness = buildSmsReadinessChecklist({
    provider: providerKey,
    api_url: settings.sms_api_url || '',
    config,
    sender_id: settings.sms_sender_id || 'SMARTLANDY',
    sender_approval_status: settings.sms_sender_approval_status || 'pending',
    default_country_code: settings.sms_default_country_code || '+254',
    pricing: {
      default_sms_provider_cost: settings.default_sms_provider_cost,
      default_sms_sell_price: settings.default_sms_sell_price,
      sms_currency: settings.sms_currency || settings.currency || 'KES'
    }
  });

  return {
    provider: settings.sms_provider || '',
    provider_key: providerKey,
    provider_profile: getSmsProviderProfile(providerKey),
    api_url: settings.sms_api_url || '',
    sender_id: settings.sms_sender_id || 'SMARTLANDY',
    sender_id_type: settings.sms_sender_id_type || 'transactional',
    sender_approval_status: settings.sms_sender_approval_status || 'pending',
    default_country_code: settings.sms_default_country_code || '+254',
    status: settings.sms_status || 'not_configured',
    last_tested_at: settings.sms_last_tested_at || null,
    sms_last_error: settings.sms_last_error || null,
    sms_billing_enabled: Boolean(settings.sms_billing_enabled),
    default_sms_sell_price: String(settings.default_sms_sell_price ?? '0.0000'),
    default_sms_provider_cost: String(settings.default_sms_provider_cost ?? '0.0000'),
    sms_currency: settings.sms_currency || settings.currency || 'KES',
    sms_free_monthly_allowance: Number(settings.sms_free_monthly_allowance || 0),
    sms_markup_strategy: settings.sms_markup_strategy || 'fixed',
    config_masked: settings.sms_config_encrypted ? maskSmsConfig(config) : {},
    has_credentials: Boolean(settings.sms_config_encrypted),
    readiness
  };
}

function normalizeSmsUsageSummary(row = {}) {
  return {
    sent_today: Number(row.sent_today || 0),
    sent_month: Number(row.sent_month || 0),
    failed_month: Number(row.failed_month || 0),
    blocked_month: Number(row.blocked_month || 0),
    provider_cost_month: moneyString(row.provider_cost_month),
    billed_revenue_month: moneyString(row.billed_revenue_month),
    margin_month: moneyString(row.margin_month),
    active_landlords_month: Number(row.active_landlords_month || 0)
  };
}

function normalizeSmsUsageLandlordRow(row = {}) {
  return {
    organization_id: row.organization_id || null,
    organization_name: row.organization_name || 'Platform / Unassigned',
    sent_month: Number(row.sent_month || 0),
    failed_month: Number(row.failed_month || 0),
    blocked_month: Number(row.blocked_month || 0),
    provider_cost_month: moneyString(row.provider_cost_month),
    billed_revenue_month: moneyString(row.billed_revenue_month),
    margin_month: moneyString(row.margin_month),
    sender_id: row.sender_id || '',
    sender_approval_status: row.sender_approval_status || 'pending',
    last_sms_status: row.last_sms_status || '',
    last_error: row.last_error || '',
    last_sms_at: row.last_sms_at || null
  };
}

function buildLocalSmsUsageSummary(rows, todayStart, monthStart) {
  const monthly = rows.filter(row => new Date(row.created_at).getTime() >= monthStart.getTime());
  const today = rows.filter(row => new Date(row.created_at).getTime() >= todayStart.getTime());
  const sentStatuses = new Set(['sent', 'delivered']);

  return normalizeSmsUsageSummary({
    sent_today: today.filter(row => sentStatuses.has(row.status)).length,
    sent_month: monthly.filter(row => sentStatuses.has(row.status)).length,
    failed_month: monthly.filter(row => row.status === 'failed').length,
    blocked_month: monthly.filter(row => row.status === 'blocked').length,
    provider_cost_month: monthly.reduce((sum, row) => sum + Number(row.provider_total_cost || 0), 0),
    billed_revenue_month: monthly.reduce((sum, row) => sum + Number(row.billed_total_amount || 0), 0),
    margin_month: monthly.reduce((sum, row) => sum + Number(row.margin_amount || 0), 0),
    active_landlords_month: new Set(monthly.map(row => row.organization_id).filter(Boolean)).size
  });
}

function buildLocalSmsUsageLandlords(rows, organizations, settings, monthStart) {
  const monthly = rows.filter(row => new Date(row.created_at).getTime() >= monthStart.getTime());
  const byOrg = new Map();

  for (const row of monthly) {
    const key = row.organization_id || 'platform';
    const current = byOrg.get(key) || {
      organization_id: row.organization_id || null,
      organization_name: organizations.find(org => Number(org.id) === Number(row.organization_id))?.name || 'Platform / Unassigned',
      sent_month: 0,
      failed_month: 0,
      blocked_month: 0,
      provider_cost_month: 0,
      billed_revenue_month: 0,
      margin_month: 0,
      sender_id: row.sender_id || '',
      sender_approval_status: settings.sms_sender_approval_status || 'pending',
      last_sms_status: '',
      last_error: '',
      last_sms_at: null
    };

    if (row.status === 'sent' || row.status === 'delivered') current.sent_month += 1;
    if (row.status === 'failed') current.failed_month += 1;
    if (row.status === 'blocked') current.blocked_month += 1;
    current.provider_cost_month += Number(row.provider_total_cost || 0);
    current.billed_revenue_month += Number(row.billed_total_amount || 0);
    current.margin_month += Number(row.margin_amount || 0);

    if (!current.last_sms_at || new Date(row.created_at).getTime() > new Date(current.last_sms_at).getTime()) {
      current.sender_id = row.sender_id || current.sender_id;
      current.last_sms_status = row.status || '';
      current.last_error = row.failure_reason || '';
      current.last_sms_at = row.created_at || null;
    }

    byOrg.set(key, current);
  }

  return Array.from(byOrg.values()).map(normalizeSmsUsageLandlordRow);
}

function moneyString(value) {
  const numeric = Number(value || 0);
  return (Number.isFinite(numeric) ? numeric : 0).toFixed(2);
}

function sanitizeSmtpErrorMessage(msg, config = {}) {
  if (!msg) return '';
  let sanitized = String(msg);

  const sensitiveFields = ['password', 'username', 'from_email', 'host'];
  for (const field of sensitiveFields) {
    const val = config[field];
    if (val && typeof val === 'string' && val.length > 2) {
      const escapedVal = val.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const reg = new RegExp(escapedVal, 'gi');
      sanitized = sanitized.replace(reg, '********');
    }
  }

  sanitized = sanitized.replace(/(password|pass|token|apikey|api_key|secret|auth)\s*[=:]\s*[^\s&;,\"]+/gi, '$1=********');
  sanitized = sanitized.replace(/(https?|smtps?):\/\/[^\s:@]+:[^\s:@]+@/gi, '$1://********:********@');

  return sanitized;
}

async function ensurePlatformBillingSettings(activeDb) {
  let settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  if (settings) {
    return settings;
  }

  if (pgDb) {
    await pgDb.query(
      `
        INSERT INTO platform_billing_settings (
          id,
          country,
          currency,
          price_per_active_tenant,
          grace_period_days,
          is_default,
          mpesa_shortcode
        )
        VALUES (1, 'Kenya', 'KES', 200, 7, true, '174379')
        ON CONFLICT (id) DO NOTHING
      `
    );
  } else {
    activeDb.insert('platform_billing_settings', defaultPlatformBillingSettingsRow());
  }

  settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  return settings;
}

app.get('/api/admin/platform-email', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  res.json(platformEmailResponseFromSettings(settings));
});

app.put('/api/admin/platform-email', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;
  const { config_json } = req.body || {};

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await ensurePlatformBillingSettings(activeDb);
  if (!settings) {
    return res.status(500).json({ error: 'Failed to initialize platform settings.' });
  }

  const { configForStorage } = prepareSmtpConfigForStorage({
    incomingConfig: config_json || {},
    existingEncryptedConfig: settings.smtp_config_encrypted || null
  });

  const missing = validateSmtpConfig(configForStorage);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required SMTP fields: ${missing.join(', ')}.` });
  }

  const encryptedConfig = encryptConfig(configForStorage);
  const nextStatus = 'verified';

  const updated = await activeDb.update('platform_billing_settings', settings.id, {
    smtp_config_encrypted: encryptedConfig,
    smtp_status: nextStatus,
    smtp_last_tested_at: null,
    smtp_last_error: null
  });

  await activeDb.logAudit(
    null,
    userId,
    'super_admin',
    'platform_email_saved',
    'platform_billing_settings',
    settings.id,
    { smtp_status: settings.smtp_status || 'not_configured' },
    { smtp_status: nextStatus },
    'Platform email configuration saved.'
  );

  res.json({
    status: nextStatus,
    last_tested_at: null,
    smtp_last_error: null,
    config_masked: maskSmtpConfig(configForStorage),
    has_credentials: true,
    updated: updated[0] || null
  });
});

app.post('/api/admin/platform-email/test', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;
  const { to } = req.body || {};

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  if (!settings?.smtp_config_encrypted) {
    return res.status(400).json({ error: 'Platform email is not configured.' });
  }

  const config = normalizeSmtpConfig(decryptConfig(settings.smtp_config_encrypted));
  const missing = validateSmtpConfig(config);
  if (missing.length > 0) {
    await activeDb.update('platform_billing_settings', settings.id, {
      smtp_status: 'needs_credentials'
    });
    await activeDb.logAudit(null, userId, 'super_admin', 'platform_email_test_failed', 'platform_billing_settings', settings.id, { smtp_status: settings.smtp_status || 'not_configured' }, { smtp_status: 'needs_credentials' }, 'Platform email test failed because credentials are incomplete.');
    return res.status(400).json({ error: `Missing required SMTP fields: ${missing.join(', ')}.` });
  }

  const adminUser = await activeDb.findOne('users', { id: userId });
  const recipient = to || adminUser?.email || null;
  if (!recipient) {
    return res.status(400).json({ error: 'Provide a test recipient email address.' });
  }

  try {
    const { sendEmailWithConfig } = await import('./mailerService.js');
    const { subject, html, text } = renderTemplate('smtp_test', {
      recipientName: 'Administrator',
      host: config.host,
      configuredBy: 'Super Admin'
    });
    const result = await sendEmailWithConfig(config, { to: recipient, subject, html, text });

    await activeDb.update('platform_billing_settings', settings.id, {
      smtp_status: 'active',
      smtp_last_tested_at: new Date().toISOString(),
      smtp_last_error: null
    });

    await activeDb.logAudit(null, userId, 'super_admin', 'platform_email_test_sent', 'platform_billing_settings', settings.id, { smtp_status: settings.smtp_status || 'verified' }, { smtp_status: 'active', recipient }, 'Platform test email sent successfully.');

    return res.json({ success: true, message_id: result.messageId || null, status: 'active', last_tested_at: new Date().toISOString(), smtp_last_error: null });
  } catch (error) {
    const safeErrorMsg = sanitizeSmtpErrorMessage(error.message, config);
    await activeDb.update('platform_billing_settings', settings.id, {
      smtp_status: 'test_failed',
      smtp_last_tested_at: new Date().toISOString(),
      smtp_last_error: safeErrorMsg
    });

    await activeDb.logAudit(null, userId, 'super_admin', 'platform_email_test_failed', 'platform_billing_settings', settings.id, { smtp_status: settings.smtp_status || 'verified' }, { smtp_status: 'test_failed' }, `Platform test email failed: ${safeErrorMsg}`);

    return res.status(502).json({ error: safeErrorMsg, status: 'test_failed' });
  }
});

function sanitizeSmsErrorMessage(msg, config = {}) {
  if (!msg) return '';
  let sanitized = String(msg);
  const sensitiveFields = ['api_key', 'bearer_token', 'client_id', 'password', 'username'];
  for (const field of sensitiveFields) {
    const val = config[field];
    if (val && typeof val === 'string' && val.length > 2) {
      const escapedVal = val.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const reg = new RegExp(escapedVal, 'gi');
      substitutions:
      sanitized = sanitized.replace(reg, '********');
    }
  }
  sanitized = sanitized.replace(/(key|token|password|pass|secret|auth)\s*[=:]\s*[^\s&;,\"]+/gi, '$1=********');
  return sanitized;
}

app.get('/api/admin/platform-sms', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  await activeDb.logAudit(null, userId, 'super_admin', 'platform_sms_viewed', 'platform_billing_settings', settings?.id || 1, null, null, 'Platform SMS Gateway configuration viewed.');
  res.json(platformSmsResponseFromSettings(settings));
});

app.get('/api/admin/platform-sms/providers', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  res.json({ providers: listSmsProviderProfiles() });
});

app.get('/api/admin/platform-sms/readiness', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  const response = platformSmsResponseFromSettings(settings);
  res.json({
    provider: response.provider,
    provider_key: response.provider_key,
    provider_profile: response.provider_profile,
    readiness: response.readiness,
    status: response.status,
    has_credentials: response.has_credentials
  });
});

app.get('/api/admin/platform-sms/usage', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  if (pgDb) {
    const summaryRes = await pgDb.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status IN ('sent', 'delivered') AND created_at >= $1) AS sent_today,
          COUNT(*) FILTER (WHERE status IN ('sent', 'delivered') AND created_at >= $2) AS sent_month,
          COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= $2) AS failed_month,
          COUNT(*) FILTER (WHERE status = 'blocked' AND created_at >= $2) AS blocked_month,
          COALESCE(SUM(provider_total_cost) FILTER (WHERE created_at >= $2), 0) AS provider_cost_month,
          COALESCE(SUM(billed_total_amount) FILTER (WHERE created_at >= $2), 0) AS billed_revenue_month,
          COALESCE(SUM(margin_amount) FILTER (WHERE created_at >= $2), 0) AS margin_month,
          COUNT(DISTINCT organization_id) FILTER (WHERE organization_id IS NOT NULL AND created_at >= $2) AS active_landlords_month
        FROM sms_usage_ledger
      `,
      [todayStart.toISOString(), monthStart.toISOString()]
    );

    const landlordRes = await pgDb.query(
      `
        WITH monthly AS (
          SELECT
            organization_id,
            COUNT(*) FILTER (WHERE status IN ('sent', 'delivered')) AS sent_month,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed_month,
            COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_month,
            COALESCE(SUM(provider_total_cost), 0) AS provider_cost_month,
            COALESCE(SUM(billed_total_amount), 0) AS billed_revenue_month,
            COALESCE(SUM(margin_amount), 0) AS margin_month
          FROM sms_usage_ledger
          WHERE created_at >= $1
          GROUP BY organization_id
        ),
        latest AS (
          SELECT DISTINCT ON (organization_id)
            organization_id,
            status AS last_sms_status,
            failure_reason AS last_error,
            sender_id,
            provider,
            created_at AS last_sms_at
          FROM sms_usage_ledger
          WHERE created_at >= $1
          ORDER BY organization_id, created_at DESC, id DESC
        )
        SELECT
          o.id AS organization_id,
          o.name AS organization_name,
          COALESCE(monthly.sent_month, 0) AS sent_month,
          COALESCE(monthly.failed_month, 0) AS failed_month,
          COALESCE(monthly.blocked_month, 0) AS blocked_month,
          COALESCE(monthly.provider_cost_month, 0) AS provider_cost_month,
          COALESCE(monthly.billed_revenue_month, 0) AS billed_revenue_month,
          COALESCE(monthly.margin_month, 0) AS margin_month,
          latest.sender_id,
          pbs.sms_sender_approval_status AS sender_approval_status,
          latest.last_sms_status,
          latest.last_error,
          latest.last_sms_at
        FROM monthly
        LEFT JOIN organizations o ON o.id = monthly.organization_id
        LEFT JOIN latest ON latest.organization_id IS NOT DISTINCT FROM monthly.organization_id
        CROSS JOIN (SELECT sms_sender_approval_status FROM platform_billing_settings WHERE id = 1) pbs
        ORDER BY monthly.sent_month DESC, monthly.failed_month DESC, organization_name NULLS LAST
      `,
      [monthStart.toISOString()]
    );

    return res.json({
      summary: normalizeSmsUsageSummary(summaryRes.rows[0]),
      landlords: landlordRes.rows.map(normalizeSmsUsageLandlordRow)
    });
  }

  const rows = activeDb.get('sms_usage_ledger') || [];
  const orgs = activeDb.get('organizations') || [];
  const settings = activeDb.findOne('platform_billing_settings', { id: 1 }) || {};
  const summary = buildLocalSmsUsageSummary(rows, todayStart, monthStart);
  const landlords = buildLocalSmsUsageLandlords(rows, orgs, settings, monthStart);

  res.json({ summary, landlords });
});

app.put('/api/admin/platform-sms/pricing', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const validation = validateSmsPricingInput(req.body || {});
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const settings = await ensurePlatformBillingSettings(activeDb);
  const updatedRows = await activeDb.update('platform_billing_settings', settings.id, validation.value);
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;

  await activeDb.logAudit(
    null,
    userId,
    'super_admin',
    'platform_sms_pricing_saved',
    'platform_billing_settings',
    settings.id,
    {
      default_sms_provider_cost: settings.default_sms_provider_cost,
      default_sms_sell_price: settings.default_sms_sell_price,
      sms_billing_enabled: settings.sms_billing_enabled
    },
    validation.value,
    'Platform SMS pricing settings saved.'
  );

  res.json(platformSmsResponseFromSettings({ ...settings, ...(updated || validation.value) }));
});

app.put('/api/admin/platform-sms', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;
  const { provider, api_url, sender_id, sender_id_type, sender_approval_status, default_country_code, config_json } = req.body || {};

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await ensurePlatformBillingSettings(activeDb);
  if (!settings) {
    return res.status(500).json({ error: 'Failed to initialize platform settings.' });
  }

  const { configForStorage } = prepareSmsConfigForStorage({
    incomingConfig: config_json || {},
    existingEncryptedConfig: settings.sms_config_encrypted || null
  });

  const providerKey = normalizeProviderKey(provider || '');
  const fieldValidation = validateSmsProviderConfig({
    provider: providerKey,
    api_url,
    api_key: configForStorage.api_key,
    bearer_token: configForStorage.bearer_token,
    client_id: configForStorage.client_id,
    default_country_code,
    password: configForStorage.password,
    sender_id,
    service_id: configForStorage.service_id,
    username: configForStorage.username
  });

  if (fieldValidation.error) {
    return res.status(400).json({ error: fieldValidation.error });
  }

  const missing = validateSmsConfig(configForStorage, providerKey);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required SMS fields: ${missing.join(', ')}.` });
  }

  const encryptedConfig = encryptConfig(configForStorage);
  const nextStatus = 'verified';

  const updated = await activeDb.update('platform_billing_settings', settings.id, {
    sms_provider: providerKey || null,
    sms_api_url: api_url || null,
    sms_config_encrypted: encryptedConfig,
    sms_sender_id: sender_id || 'SMARTLANDY',
    sms_sender_id_type: sender_id_type || 'transactional',
    sms_sender_approval_status: sender_approval_status || 'pending',
    sms_default_country_code: default_country_code || '+254',
    sms_status: nextStatus,
    sms_last_tested_at: null,
    sms_last_error: null
  });

  await activeDb.logAudit(
    null,
    userId,
    'super_admin',
    'platform_sms_saved',
    'platform_billing_settings',
    settings.id,
    { sms_status: settings.sms_status || 'not_configured' },
    { sms_status: nextStatus },
    'Platform SMS Gateway configuration saved.'
  );

  const mergedSettings = {
    ...settings,
    sms_provider: providerKey || null,
    sms_api_url: api_url || null,
    sms_config_encrypted: encryptedConfig,
    sms_sender_id: sender_id || 'SMARTLANDY',
    sms_sender_id_type: sender_id_type || 'transactional',
    sms_sender_approval_status: sender_approval_status || 'pending',
    sms_default_country_code: default_country_code || '+254',
    sms_status: nextStatus,
    sms_last_tested_at: null,
    sms_last_error: null
  };

  res.json(platformSmsResponseFromSettings(mergedSettings));
});

app.post('/api/admin/platform-sms/test', async (req, res) => {
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;
  const { to } = req.body || {};

  if (role !== 'super_admin' || !userId) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Super admin access is required.' });
  }

  const settings = await activeDb.findOne('platform_billing_settings', { id: 1 });
  if (!settings?.sms_config_encrypted) {
    return res.status(400).json({ error: 'Platform SMS is not configured.' });
  }

  const config = normalizeSmsConfig(decryptConfig(settings.sms_config_encrypted));
  const provider = settings.sms_provider || 'mock';
  const apiUrl = settings.sms_api_url || '';
  const senderId = settings.sms_sender_id || 'SMARTLANDY';
  const validation = validateSmsProviderConfig({
    provider,
    api_url: apiUrl,
    api_key: config.api_key,
    bearer_token: config.bearer_token,
    client_id: config.client_id,
    default_country_code: settings.sms_default_country_code || '+254',
    password: config.password,
    sender_id: senderId,
    service_id: config.service_id,
    username: config.username
  });
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const pricingSettings = await getPlatformSmsPricingSettings(activeDb);

    const result = await sendSmsViaAdapter({
      provider,
      api_url: apiUrl,
      api_key: config.api_key,
      api_key_header_name: config.api_key_header_name,
      bearer_token: config.bearer_token,
      client_id: config.client_id,
      callback_url: config.callback_url,
      default_country_code: settings.sms_default_country_code || '+254',
      password: config.password,
      service_id: config.service_id,
      sender_id: senderId,
      username: config.username,
      to,
      message: 'Smart Landlord SMS Gateway Verification Test.',
      sender_approval_status: settings.sms_sender_approval_status
    });

    if (!result.success && !result.ok) {
      const safeResultError = result.sanitized_error || result.error || 'Unknown gateway error.';
      const blocked = result.status === 'blocked' || (/blocked/i.test(safeResultError) && /sender id|live sms/i.test(safeResultError));
      const ledger = await recordSmsUsageLedger(activeDb, {
        organization_id: null,
        message_type: 'test',
        recipient_phone_e164: to,
        sender_id: senderId,
        provider,
        status: blocked ? 'blocked' : 'failed',
        failure_reason: safeResultError,
        source: 'test_sms',
        pricingSettings,
        sensitiveValues: [config.api_key, config.client_id, config.bearer_token, config.password]
      });

      await logSmsSystemError(activeDb, {
        provider,
        status: blocked ? 'blocked' : 'failed',
        message: safeResultError,
        ledger_id: ledger?.id || null,
        sensitiveValues: [config.api_key, config.client_id, config.bearer_token, config.password]
      });

      throw new Error(safeResultError);
    }

    await recordSmsUsageLedger(activeDb, {
      organization_id: null,
      message_type: 'test',
      recipient_phone_e164: to,
      sender_id: senderId,
      provider,
      provider_message_id: result.provider_message_id || result.messageId || null,
      status: 'sent',
      source: 'test_sms',
      pricingSettings
    });

    await activeDb.update('platform_billing_settings', settings.id, {
      sms_status: 'active',
      sms_last_tested_at: new Date().toISOString(),
      sms_last_error: null
    });

    await activeDb.logAudit(
      null,
      userId,
      'super_admin',
      'platform_sms_test_sent',
      'platform_billing_settings',
      settings.id,
      { sms_status: settings.sms_status || 'verified' },
      { sms_status: 'active', recipient: to },
      'Platform test SMS sent successfully.'
    );

    return res.json({
      ok: true,
      success: true,
      provider,
      provider_message_id: result.provider_message_id || result.messageId || null,
      status: 'active',
      last_tested_at: new Date().toISOString(),
      sms_last_error: null
    });
  } catch (error) {
    const safeErrorMsg = sanitizeSmsErrorMessage(error.message, config);
    if (!/Live SMS sending is blocked|Invalid API Key|Unknown gateway error|Unsupported SMS provider|required|Unreachable|readiness-only/i.test(error.message || '')) {
      const provider = settings.sms_provider || 'mock';
      const senderId = settings.sms_sender_id || 'SMARTLANDY';
      const ledger = await recordSmsUsageLedger(activeDb, {
        organization_id: null,
        message_type: 'test',
        recipient_phone_e164: to,
        sender_id: senderId,
        provider,
        status: 'failed',
        failure_reason: safeErrorMsg,
        source: 'test_sms',
        sensitiveValues: [config.api_key, config.client_id, config.bearer_token, config.password]
      });
      await logSmsSystemError(activeDb, {
        provider,
        status: 'failed',
        message: safeErrorMsg,
        ledger_id: ledger?.id || null,
        sensitiveValues: [config.api_key, config.client_id, config.bearer_token, config.password]
      });
    }
    await activeDb.update('platform_billing_settings', settings.id, {
      sms_status: 'test_failed',
      sms_last_tested_at: new Date().toISOString(),
      sms_last_error: safeErrorMsg
    });

    await activeDb.logAudit(
      null,
      userId,
      'super_admin',
      'platform_sms_test_failed',
      'platform_billing_settings',
      settings.id,
      { sms_status: settings.sms_status || 'verified' },
      { sms_status: 'test_failed' },
      `Platform test SMS failed: ${safeErrorMsg}`
    );

    return res.status(502).json({ ok: false, success: false, error: safeErrorMsg, sanitized_error: safeErrorMsg, status: 'test_failed' });
  }
});

// Update Organization Profile details
app.put('/api/settings/profile', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const userId = req.auth?.userId;
  const activeDb = pgDb || db;

  if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

  const org = await activeDb.findOne('organizations', { id: orgId });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const { name, email, phone_number, country, billing_currency, type, business_name, registration_number, tax_identifier } = req.body;

  const updates = {
    name: name !== undefined ? name : org.name,
    email: email !== undefined ? email : org.email,
    phone_number: phone_number !== undefined ? phone_number : org.phone_number,
    country: country !== undefined ? country : org.country,
    billing_currency: billing_currency !== undefined ? billing_currency : org.billing_currency,
    type: type !== undefined ? type : org.type,
    business_name: business_name !== undefined ? business_name : org.business_name,
    registration_number: registration_number !== undefined ? registration_number : org.registration_number,
    tax_identifier: tax_identifier !== undefined ? tax_identifier : org.tax_identifier
  };

  await activeDb.update('organizations', orgId, updates);
  const updatedOrg = await activeDb.findOne('organizations', { id: orgId });

  // Sync owner user details
  if (updatedOrg.owner_user_id) {
    await activeDb.update('users', updatedOrg.owner_user_id, {
      name: updatedOrg.name,
      email: updatedOrg.email,
      phone_number: updatedOrg.phone_number
    });
  }

  await activeDb.logAudit(orgId, userId, role, 'profile_updated', 'organizations', orgId, org, updatedOrg, 'Landlord profile details updated.');

  res.json({ organization: updatedOrg });
});

// Financial Archive (Requires PIN)
app.post('/api/settings/archive', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const { pin, before_date, reason } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const activeDb = pgDb || db;
  const org = await activeDb.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const txs = await activeDb.find('transactions', { organization_id: orgId, status: 'reconciled' });
  const toArchive = txs.filter(t => new Date(t.transaction_date) < new Date(before_date));

  for (const tx of toArchive) {
    // 1. Move to archived
    await activeDb.insert('archived_transactions', {
      original_transaction_id: tx.id,
      organization_id: orgId,
      archived_by: userId,
      archive_reason: reason || 'Manual clean-up',
      archived_at: new Date().toISOString(),
      transaction_snapshot: JSON.stringify(tx)
    });

    // 2. Mark ledger status
    await activeDb.update('transactions', tx.id, { status: 'archived' });
  }

  await activeDb.logAudit(orgId, userId, role, 'financial_archive_move', 'transactions', null, { before_date, count: toArchive.length }, null, `Archived ${toArchive.length} transactions before ${before_date}`, 'success');

  res.json({ success: true, count: toArchive.length });
});

// --- COMPLIANCE & DELETION REQUESTS API ---

// Request Account / Data Deletion (Landlord)
app.post('/api/compliance/delete-request', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const { reason, target_type, target_tenant_id } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const activeDb = pgDb || db;
  const request = await activeDb.insert('deletion_requests', {
    organization_id: orgId,
    requested_by: userId,
    request_type: target_type || 'organization_account',
    target_user_id: target_type === 'organization_account' ? userId : null,
    target_tenant_id: target_type === 'tenant_data' && target_tenant_id ? parseInt(target_tenant_id) : null,
    status: 'requested',
    reason,
    completed_at: null
  });

  await activeDb.logAudit(orgId, userId, role, 'account_deletion_requested', 'deletion_requests', request.id, null, request, `Requested data deletion: ${reason}`);

  res.status(201).json(request);
});

// View Deletion Requests (Landlord)
app.get('/api/compliance/delete-request', async (req, res) => {
  const orgId = req.auth?.organizationId;
  const activeDb = pgDb || db;
  const requests = await activeDb.find('deletion_requests', { organization_id: orgId });
  const sorted = [...requests].sort((a, b) => b.id - a.id);
  res.json(sorted);
});

// View All Deletion Requests (Super Admin)
app.get('/api/admin/compliance/delete-requests', async (req, res) => {
  if (pgDb) {
    const result = await pgDb.query(
      `SELECT d.*, u.name as requester_name, o.name as org_name
       FROM deletion_requests d
       JOIN users u ON d.requested_by = u.id
       JOIN organizations o ON d.organization_id = o.id
       ORDER BY d.created_at DESC`
    );
    res.json(result.rows);
  } else {
    const requests = db.get('deletion_requests');
    const users = db.get('users');
    const orgs = db.get('organizations');

    const detailed = requests.map(r => {
      const u = users.find(user => user.id === r.requested_by);
      const o = orgs.find(org => org.id === r.organization_id);
      return {
        ...r,
        requester_name: u ? u.name : 'Unknown User',
        org_name: o ? o.name : 'Unknown Organization'
      };
    });
    const sorted = [...detailed].sort((a, b) => b.id - a.id);
    res.json(sorted);
  }
});

// Process Deletion Request (Super Admin)
app.post('/api/admin/compliance/delete-requests/:id/process', async (req, res) => {
  const { action, reject_reason } = req.body;
  const requestId = parseInt(req.params.id);
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const activeDb = pgDb || db;
  const request = await activeDb.findOne('deletion_requests', { id: requestId });
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  if (action === 'reject') {
    await activeDb.update('deletion_requests', requestId, {
      status: 'rejected',
      completed_at: new Date().toISOString()
    });

    await activeDb.logAudit(request.organization_id, userId, role, 'account_deletion_rejected', 'deletion_requests', requestId, request, null, `Rejected: ${reject_reason || 'No reason specified'}`);
    return res.json({ success: true, status: 'rejected' });
  }

  if (action === 'approve') {
    await activeDb.update('deletion_requests', requestId, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });

    const orgId = request.organization_id;

    if (request.request_type === 'organization_account') {
      if (pgDb) {
        await pgDb.update('organizations', orgId, {
          status: 'inactive',
          deleted_at: new Date().toISOString(),
          security_pin_hash: null
        });

        const members = await pgDb.find('organization_members', { organization_id: orgId });
        for (const m of members) {
          const userUuid = Math.floor(1000 + Math.random() * 9000);
          await pgDb.update('users', parseInt(m.user_id), {
            name: `[ANONYMIZED_USER_${userUuid}]`,
            email: `anonymized_${userUuid}@domain.com`,
            phone_number: `+000000000${userUuid}`,
            status: 'inactive'
          });
        }

        await pgDb.update('organization_integrations', { organization_id: orgId }, {
          config_json_encrypted: null
        });
      } else {
        db.update('organizations', orgId, {
          status: 'inactive',
          deleted_at: new Date().toISOString(),
          security_pin_hash: null
        });

        const members = db.find('organization_members', { organization_id: orgId });
        for (const m of members) {
          const userUuid = Math.floor(1000 + Math.random() * 9000);
          db.update('users', parseInt(m.user_id), {
            name: `[ANONYMIZED_USER_${userUuid}]`,
            email: `anonymized_${userUuid}@domain.com`,
            phone_number: `+000000000${userUuid}`,
            status: 'inactive'
          });
        }

        db.update('organization_integrations', { organization_id: orgId }, {
          config_json_encrypted: null
        });
      }
    }
    else if (request.request_type === 'tenant_data') {
      const tenantId = request.target_tenant_id;
      if (tenantId) {
        const tenantUuid = Math.floor(1000 + Math.random() * 9000);
        if (pgDb) {
          await pgDb.update('tenants', tenantId, {
            full_name: `[ANONYMIZED_TENANT_${tenantUuid}]`,
            phone_number: `+000000000${tenantUuid}`,
            email: `anonymized_${tenantUuid}@domain.com`,
            id_number: 'ANONYMIZED',
            emergency_contact_name: 'ANONYMIZED',
            emergency_contact_phone: `+000000000${tenantUuid}`,
            status: 'inactive',
            deleted_at: new Date().toISOString()
          });
        } else {
          db.update('tenants', tenantId, {
            full_name: `[ANONYMIZED_TENANT_${tenantUuid}]`,
            phone_number: `+000000000${tenantUuid}`,
            email: `anonymized_${tenantUuid}@domain.com`,
            id_number: 'ANONYMIZED',
            emergency_contact_name: 'ANONYMIZED',
            emergency_contact_phone: `+000000000${tenantUuid}`,
            status: 'inactive',
            deleted_at: new Date().toISOString()
          });
        }
      }
    }
    else if (request.request_type === 'api_credentials') {
      if (pgDb) {
        await pgDb.update('organization_integrations', { organization_id: orgId }, {
          config_json_encrypted: null
        });
      } else {
        db.update('organization_integrations', { organization_id: orgId }, {
          config_json_encrypted: null
        });
      }
    }

    await activeDb.logAudit(request.organization_id, userId, role, 'account_deletion_approved', 'deletion_requests', requestId, request, null, 'Approved and PII anonymized.');
    return res.json({ success: true, status: 'completed' });
  }

  res.status(400).json({ error: 'Invalid action.' });
});

// --- LIGHT MAINTENANCE / WORK ORDERS API ---

// Maintenance list
app.get('/api/maintenance', (req, res) => {
  const orgId = req.auth?.organizationId;
  const role = req.auth?.role;
  const userId = req.auth?.userId;

  let requests = db.find('maintenance_requests', { organization_id: orgId });

  // Caretaker restrictions
  if (role === 'caretaker') {
    const assignments = db.find('staff_assignments', { caretaker_user_id: userId, status: 'active' });
    const assignmentIds = assignments.map(a => a.id);
    const assignedPropLinks = db.get('staff_assignment_properties').filter(link => assignmentIds.includes(link.staff_assignment_id));
    const assignedPropIds = assignedPropLinks.map(link => link.property_id);

    requests = requests.filter(r => assignedPropIds.includes(r.property_id));
  }

  const properties = db.get('properties');
  const units = db.get('units');

  const detailed = requests.map(r => {
    const prop = properties.find(p => p.id === r.property_id);
    const unit = units.find(u => u.id === r.unit_id);
    return {
      ...r,
      property_name: prop ? prop.name : 'Unknown Property',
      unit_code: unit ? unit.unit_code : 'General Area'
    };
  });

  res.json(detailed);
});

// Create request
app.post('/api/maintenance', (req, res) => {
  const orgId = req.auth?.organizationId;
  const { property_id, unit_id, title, description, priority, assigned_to_user_id } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const request = db.insert('maintenance_requests', {
    organization_id: orgId,
    property_id: parseInt(property_id),
    unit_id: unit_id ? parseInt(unit_id) : null,
    tenant_id: null,
    reported_by_user_id: userId,
    title,
    description,
    status: 'open',
    priority: priority || 'medium',
    photo_url: '',
    assigned_to_user_id: assigned_to_user_id ? parseInt(assigned_to_user_id) : null,
    estimated_cost: null,
    actual_cost: null,
    cost_approved_by: null,
    resolved_at: null
  });

  db.logAudit(orgId, userId, role, 'maintenance_created', 'maintenance_requests', request.id, null, request);
  res.status(201).json(request);
});

// Update progress/status
app.put('/api/maintenance/:id', (req, res) => {
  const orgId = req.auth?.organizationId;
  const reqId = parseInt(req.params.id);
  const { status, description, estimated_cost, actual_cost } = req.body;
  const userId = req.auth?.userId;
  const role = req.auth?.role;

  const oldVal = db.findOne('maintenance_requests', { id: reqId, organization_id: orgId });
  if (!oldVal) return res.status(404).json({ error: 'Request not found' });

  const updates = { status };
  if (description) updates.description = description;
  if (estimated_cost !== undefined) updates.estimated_cost = parseFloat(estimated_cost);
  if (actual_cost !== undefined) {
    if (role !== 'landlord') {
      return res.status(403).json({ error: 'Only landlords can log or approve actual costs.' });
    }
    updates.actual_cost = parseFloat(actual_cost);
    updates.cost_approved_by = userId;
  }

  if (status === 'resolved' && oldVal.status !== 'resolved') {
    updates.resolved_at = new Date().toISOString();
  }

  const updated = db.update('maintenance_requests', reqId, updates)[0];

  db.logAudit(orgId, userId, role, 'maintenance_updated', 'maintenance_requests', reqId, oldVal, updated);
  res.json(updated);
});

// Global error handler to guarantee JSON responses for all unhandled backend errors
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.statusCode || 500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred on the server.'
  });
});

// Serve and listen
app.listen(PORT, () => {
  console.log(`Smart Landlord Backend Server running on http://localhost:${PORT}`);
});
