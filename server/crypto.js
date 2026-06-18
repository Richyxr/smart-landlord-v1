import crypto from 'crypto';

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for integration credentials
// ---------------------------------------------------------------------------
// Secrets stored in organization_integrations.config_json_encrypted are
// encrypted at rest using AES-256-GCM.  The ENCRYPTION_KEY environment
// variable provides the master key.  A random 12-byte IV is generated per
// encryption call, ensuring identical plaintext produces different ciphertext.
//
// Ciphertext format: iv:ciphertext:authTag  (all hex-encoded, colon-separated)
//
// In demo mode (NODE_ENV !== 'production'), a deterministic fallback key is
// used if ENCRYPTION_KEY is not set.  In production, the absence of
// ENCRYPTION_KEY causes encrypt/decrypt to throw immediately.
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM recommended IV length
const TAG_LENGTH = 16;      // GCM auth tag length in bytes
const KEY_LENGTH = 32;      // AES-256 requires 32-byte key

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_FALLBACK_KEY = 'smart-landlord-dev-encryption-key-do-not-use-in-production';

/**
 * Derive a 32-byte key from the raw ENCRYPTION_KEY environment variable.
 * Uses SHA-256 so any-length passphrase produces a valid AES-256 key.
 */
function deriveKey() {
  const rawKey = process.env.ENCRYPTION_KEY;

  if (!rawKey) {
    if (IS_PRODUCTION) {
      throw new Error(
        'ENCRYPTION_KEY environment variable is required in production. ' +
        'Set it to a random string of 32+ characters.'
      );
    }
    console.warn(
      '[crypto] WARNING: ENCRYPTION_KEY is not set. Using demo fallback key. ' +
      'This is NOT safe for production.'
    );
    return crypto.createHash('sha256').update(DEMO_FALLBACK_KEY).digest();
  }

  return crypto.createHash('sha256').update(rawKey).digest();
}

// Cache the derived key at module load time.  If the env var changes at
// runtime (unlikely), the process must restart.
let _derivedKey = null;

function getKey() {
  if (!_derivedKey) {
    _derivedKey = deriveKey();
  }
  return _derivedKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param {string} plaintext — the value to encrypt (typically JSON.stringify'd credentials)
 * @returns {string} — ciphertext in the format `iv:encrypted:tag` (hex-encoded)
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string argument.');
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${encrypted}:${tag}`;
}

/**
 * Decrypt a ciphertext string produced by encrypt().
 *
 * @param {string} ciphertext — value in the format `iv:encrypted:tag` (hex-encoded)
 * @returns {string} — the original plaintext
 * @throws {Error} — if the ciphertext is malformed, the key is wrong, or the data was tampered with
 */
export function decrypt(ciphertext) {
  if (typeof ciphertext !== 'string') {
    throw new TypeError('decrypt() expects a string argument.');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format. Expected iv:encrypted:tag.');
  }

  const [ivHex, encryptedHex, tagHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}.`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${TAG_LENGTH}, got ${tag.length}.`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Mask a credentials object so no plaintext value is exposed.
 * Each value is reduced to its first 2 characters + '********',
 * or just '********' if the value is 4 characters or fewer.
 *
 * @param {object} configObj — the parsed credentials object
 * @returns {object} — a new object with all values masked
 */
export function maskConfig(configObj) {
  if (!configObj || typeof configObj !== 'object') return {};

  const masked = {};
  for (const [key, value] of Object.entries(configObj)) {
    const str = String(value);
    masked[key] = str.length > 4 ? str.substring(0, 2) + '********' : '********';
  }
  return masked;
}

/**
 * Encrypt a credentials object (JSON-serializable) for storage.
 *
 * @param {object} configObj — the plaintext credentials
 * @returns {string} — encrypted ciphertext string
 */
export function encryptConfig(configObj) {
  return encrypt(JSON.stringify(configObj));
}

/**
 * Decrypt a stored ciphertext back to a credentials object.
 * For internal server-side use only — never expose the result to the frontend.
 *
 * @param {string} encryptedString — the encrypted config from the database
 * @returns {object} — the parsed credentials object
 */
export function decryptConfig(encryptedString) {
  if (!encryptedString) return {};

  try {
    return JSON.parse(decrypt(encryptedString));
  } catch (error) {
    // If decryption fails (wrong key, legacy masked data, corrupted), return empty.
    // Log the failure but don't crash — the integration will show as needing re-configuration.
    console.error('[crypto] Failed to decrypt config:', error.message);
    return {};
  }
}
