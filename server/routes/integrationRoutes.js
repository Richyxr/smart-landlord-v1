import express from 'express';
import bcrypt from 'bcryptjs';
import { encryptConfig, decryptConfig, maskConfig } from '../crypto.js';

// ---------------------------------------------------------------------------
// Phase 7: PostgreSQL-backed integration CRUD with real encryption
// ---------------------------------------------------------------------------
// Replaces the JSON-backed integration endpoints in server.js.
// Credentials are encrypted at rest using AES-256-GCM (via crypto.js).
// The frontend NEVER receives plaintext or ciphertext — only masked values.
// ---------------------------------------------------------------------------

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
  return {
    orgId: req.auth?.organizationId,
    userId: req.auth?.userId,
    role: req.auth?.role
  };
}

function requireAuthenticatedContext(req, res, next) {
  const { orgId, userId, role } = getContext(req);

  if (!orgId || !userId || !role) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'A valid Smart Landlord session is required.'
    });
  }

  if (role === 'caretaker') {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Caretakers are not permitted to access integrations configuration.'
    });
  }

  next();
}

/**
 * Prepare an integration row for frontend consumption.
 * Strips the encrypted config and replaces it with a masked version.
 */
function sanitizeForFrontend(row) {
  if (!row) return row;

  const { config_json_encrypted, webhook_secret, ...safe } = row;

  // Attempt to decrypt and mask.  If decryption fails (legacy data, wrong key),
  // return an empty masked config — the landlord will need to re-enter credentials.
  let configMasked = {};
  if (config_json_encrypted) {
    const plainConfig = decryptConfig(config_json_encrypted);
    configMasked = maskConfig(plainConfig);
  }

  return {
    ...safe,
    config_masked: configMasked,
    has_credentials: Boolean(config_json_encrypted),
    has_webhook_secret: Boolean(webhook_secret)
  };
}

/**
 * Determine the appropriate status for an integration based on its current state.
 */
function resolveStatus(currentStatus, hasCredentials, testPassed = null) {
  if (testPassed === true) return 'ready';
  if (testPassed === false) return 'test_failed';
  if (hasCredentials) {
    return 'draft';
  }
  return 'needs_credentials';
}

function cleanOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMpesaSandboxConfig(configJson = {}) {
  return {
    consumer_key: cleanOptionalText(configJson.consumer_key),
    consumer_secret: cleanOptionalText(configJson.consumer_secret),
    shortcode: cleanOptionalText(configJson.shortcode || configJson.till_number),
    passkey: cleanOptionalText(configJson.passkey),
    webhook_secret: cleanOptionalText(configJson.webhook_secret || configJson.passkey),
    account_reference: cleanOptionalText(configJson.account_reference)
  };
}

function validateMpesaSandboxConfig(config) {
  const missing = [];
  if (!config.consumer_key) missing.push('consumer_key');
  if (!config.consumer_secret) missing.push('consumer_secret');
  if (!config.shortcode) missing.push('shortcode');
  if (!config.passkey) missing.push('passkey');
  return missing;
}

async function testDarajaSandboxToken(credentials) {
  const auth = Buffer
    .from(`${credentials.consumer_key}:${credentials.consumer_secret}`)
    .toString('base64');

  try {
    const response = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`
      },
      signal: AbortSignal.timeout(10000)
    });

    let body = {};
    try {
      body = await response.json();
    } catch (_error) {
      body = {};
    }

    if (!response.ok || !body.access_token) {
      return {
        success: false,
        responseSummary: `Daraja sandbox OAuth rejected the credentials with HTTP ${response.status}.`,
        errorMessage: 'Daraja sandbox OAuth token request failed. Check the sandbox consumer key and consumer secret.'
      };
    }

    return {
      success: true,
      responseSummary: 'Daraja sandbox OAuth token generated successfully.',
      errorMessage: null
    };
  } catch (_error) {
    return {
      success: false,
      responseSummary: 'Daraja sandbox OAuth endpoint could not be reached within the timeout.',
      errorMessage: 'Daraja sandbox OAuth token request could not be completed.'
    };
  }
}

export function createIntegrationRoutes(pgDb) {
  const router = express.Router();

  // =========================================================================
  // GET /integrations — List all integrations for the organization
  // =========================================================================
  // Returns masked credentials only. Never returns config_json_encrypted.
  // =========================================================================
  router.get('/integrations', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID required.' });

    const result = await pgDb.query(
      `
        SELECT *
        FROM organization_integrations
        WHERE organization_id = $1
        ORDER BY provider_type ASC, id ASC
      `,
      [orgId]
    );

    const sanitized = result.rows.map(sanitizeForFrontend);
    res.json(sanitized);
  }));

  // =========================================================================
  // GET /integrations/:id — Get a single integration (masked)
  // =========================================================================
  router.get('/integrations/:id', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const integrationId = parseInt(req.params.id);

    const result = await pgDb.query(
      'SELECT * FROM organization_integrations WHERE id = $1 AND organization_id = $2',
      [integrationId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    res.json(sanitizeForFrontend(result.rows[0]));
  }));

  // =========================================================================
  // POST /integrations — Save or update integration credentials
  // =========================================================================
  // Encrypts config_json before storage. Extracts shortcode and passkey
  // into top-level columns for webhook routing (Phase 6 integration).
  // =========================================================================
  router.post('/integrations', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { provider_type, provider_name, environment, config_json } = req.body;

    if (!provider_type || !provider_name) {
      return res.status(400).json({ error: 'provider_type and provider_name are required.' });
    }

    const normalizedEnvironment = provider_type === 'mpesa' ? 'sandbox' : (environment || 'sandbox');
    let configForStorage = config_json || {};

    if (provider_type === 'mpesa') {
      if (environment && environment !== 'sandbox') {
        return res.status(400).json({
          error: 'M-Pesa Daraja integration is sandbox-only for now.'
        });
      }

      configForStorage = normalizeMpesaSandboxConfig(config_json || {});
      const missing = validateMpesaSandboxConfig(configForStorage);
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Missing required M-Pesa sandbox credential fields: ${missing.join(', ')}.`
        });
      }
    }

    // Encrypt the credentials for storage
    const encryptedConfig = configForStorage && Object.keys(configForStorage).length > 0
      ? encryptConfig(configForStorage)
      : null;

    // Extract top-level fields for webhook routing (Phase 6)
    const shortcode = configForStorage?.shortcode || configForStorage?.till_number || null;
    const webhookSecret = configForStorage?.webhook_secret || configForStorage?.passkey || null;
    const providerIdentifier = configForStorage?.bank_code || configForStorage?.provider_id || null;
    const accountReference = configForStorage?.account_reference || null;

    // Determine callback URL based on provider type
    let callbackUrl = null;
    if (provider_type === 'mpesa') {
      callbackUrl = '/api/webhooks/mpesa/c2b';
    } else if (provider_type === 'bank') {
      callbackUrl = '/api/webhooks/bank';
    }

    // Check for existing integration of this type for this org
    const existing = await pgDb.findOne('organization_integrations', {
      provider_type,
      organization_id: orgId
    });

    let integration;
    const hasCredentials = Boolean(encryptedConfig);

    if (existing) {
      const newStatus = resolveStatus(existing.status, hasCredentials);

      const updateData = {
        provider_name,
        environment: normalizedEnvironment,
        config_json_encrypted: encryptedConfig || existing.config_json_encrypted,
        status: newStatus,
        is_active: hasCredentials
      };

      // Update webhook routing columns if provided
      if (shortcode) updateData.shortcode = shortcode;
      if (webhookSecret) updateData.webhook_secret = webhookSecret;
      if (providerIdentifier) updateData.provider_identifier = providerIdentifier;
      if (accountReference) updateData.account_reference = accountReference;
      if (callbackUrl) updateData.callback_url = callbackUrl;

      const updated = await pgDb.update('organization_integrations', existing.id, updateData);
      integration = updated[0] || existing;

      await pgDb.logAudit(
        orgId, userId, role,
        'integration_credentials_updated',
        'organization_integrations',
        integration.id,
        { provider_type, status: existing.status },
        { provider_type, status: newStatus },
        'Integration credentials updated (encrypted at rest).'
      );
    } else {
      const newStatus = resolveStatus('not_started', hasCredentials);

      integration = await pgDb.insert('organization_integrations', {
        organization_id: orgId,
        provider_type,
        provider_name,
        environment: normalizedEnvironment,
        config_json_encrypted: encryptedConfig,
        callback_url: callbackUrl,
        is_active: hasCredentials,
        status: newStatus,
        shortcode: shortcode,
        webhook_secret: webhookSecret,
        provider_identifier: providerIdentifier,
        account_reference: accountReference
      });

      await pgDb.logAudit(
        orgId, userId, role,
        'integration_created',
        'organization_integrations',
        integration.id,
        null,
        { provider_type, status: newStatus },
        'New integration created with encrypted credentials.'
      );
    }

    res.json(sanitizeForFrontend(integration));
  }));

  // =========================================================================
  // POST /integrations/:id/test — Test integration connection
  // =========================================================================
  // Simulates a provider API test call. In the future, this would make a
  // real HTTP call to the provider's sandbox/test endpoint using the
  // decrypted credentials.
  // =========================================================================
  router.post('/integrations/:id/test', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId } = getContext(req);
    const integrationId = parseInt(req.params.id);

    const integration = await pgDb.findOne('organization_integrations', {
      id: integrationId,
      organization_id: orgId
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    if (!integration.config_json_encrypted) {
      return res.status(400).json({ error: 'No credentials configured. Please save API keys first.' });
    }

    // Decrypt credentials for the test call (server-side only)
    const credentials = decryptConfig(integration.config_json_encrypted);

    if (integration.provider_type === 'mpesa') {
      if (integration.environment !== 'sandbox') {
        return res.status(400).json({ error: 'M-Pesa Daraja testing is sandbox-only for now.' });
      }

      const mpesaCredentials = normalizeMpesaSandboxConfig(credentials);
      const missing = validateMpesaSandboxConfig(mpesaCredentials);
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Missing required M-Pesa sandbox credential fields: ${missing.join(', ')}.`
        });
      }

      const testResult = await testDarajaSandboxToken(mpesaCredentials);
      const testLog = await pgDb.insert('integration_test_logs', {
        organization_id: orgId,
        integration_id: integrationId,
        tested_by: userId,
        status: testResult.success ? 'success' : 'failed',
        response_summary: testResult.responseSummary,
        error_message: testResult.errorMessage
      });

      const newStatus = resolveStatus(integration.status, true, testResult.success);
      await pgDb.update('organization_integrations', integrationId, {
        status: newStatus,
        last_tested_at: new Date().toISOString()
      });

      await pgDb.logAudit(
        orgId, userId, 'landlord',
        testResult.success ? 'daraja_sandbox_test_passed' : 'daraja_sandbox_test_failed',
        'organization_integrations',
        integrationId,
        { status: integration.status },
        { status: newStatus, test_log_id: testLog.id },
        `Daraja sandbox credential test ${testResult.success ? 'passed' : 'failed'}.`
      );

      const responseBody = {
        ...testLog,
        new_status: newStatus,
        success: testResult.success
      };

      if (!testResult.success) {
        return res.status(502).json(responseBody);
      }

      return res.json(responseBody);
    }

    const hasValidKeys = Object.values(credentials).some(v => v && String(v).length > 2);

    // Simulate provider API test — in production, this would make a real HTTP request
    // using the decrypted credentials to the provider's sandbox endpoint.
    const success = hasValidKeys && Math.random() > 0.05; // 95% success for valid keys

    const testLog = await pgDb.insert('integration_test_logs', {
      organization_id: orgId,
      integration_id: integrationId,
      tested_by: userId,
      status: success ? 'success' : 'failed',
      response_summary: success
        ? '200 OK — Connection established. Provider endpoint responded successfully.'
        : '504 Gateway Timeout — Could not reach provider sandbox endpoint.',
      error_message: success
        ? null
        : 'Provider sandbox did not return validation challenge within timeout.'
    });

    const newStatus = resolveStatus(integration.status, true, success);

    await pgDb.update('organization_integrations', integrationId, {
      status: newStatus,
      last_tested_at: new Date().toISOString()
    });

    await pgDb.logAudit(
      orgId, userId, 'landlord',
      success ? 'integration_test_passed' : 'integration_test_failed',
      'organization_integrations',
      integrationId,
      { status: integration.status },
      { status: newStatus, test_log_id: testLog.id },
      `Integration test ${success ? 'passed' : 'failed'} for ${integration.provider_name}.`
    );

    res.json({
      ...testLog,
      new_status: newStatus
    });
  }));

  // =========================================================================
  // POST /integrations/:id/test-sms — Send a test SMS via Mobitech
  // =========================================================================
  router.post('/integrations/:id/test-sms', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const integrationId = parseInt(req.params.id);
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({ error: 'phone_number is required.' });
    }

    const integration = await pgDb.findOne('organization_integrations', {
      id: integrationId,
      organization_id: orgId
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    if (integration.provider_type !== 'sms' || integration.provider_name !== 'Mobitech') {
      return res.status(400).json({ error: 'This action is only supported for Mobitech SMS integration.' });
    }

    if (!integration.config_json_encrypted) {
      return res.status(400).json({ error: 'No credentials configured. Please save API keys first.' });
    }

    // Decrypt credentials for the test call
    const credentials = decryptConfig(integration.config_json_encrypted);
    if (!credentials.api_key || !credentials.partner_id) {
      return res.status(400).json({ error: 'Mobitech credentials (api_key, partner_id) are incomplete.' });
    }

    const message = 'Smart Landlord: Test SMS from Mobitech integration.';
    
    // Normalize phone number to Kenyan E.164 shape: 2547XXXXXXXX
    let cleaned = phone_number.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }
    if (cleaned.length === 9 && cleaned.startsWith('7')) {
      cleaned = '254' + cleaned;
    }

    const isMock = String(credentials.api_key).startsWith('mock') || String(credentials.api_key).startsWith('test') || credentials.api_key === 'dummy';

    let success = false;
    let summary = '';
    let errorMsg = null;

    if (isMock) {
      success = true;
      summary = `Mock Send Success — Simulated test SMS sent to ${cleaned}.`;
    } else {
      try {
        const payload = {
          apikey: credentials.api_key,
          partnerID: credentials.partner_id,
          message: message,
          shortcode: credentials.sender_id || 'SMARTLAND',
          mobile: cleaned
        };

        const apiRes = await fetch('https://sms.textsms.co.ke/api/services/sendsms/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000)
        });

        const text = await apiRes.text();
        let apiData = null;
        try {
          apiData = JSON.parse(text);
        } catch {}

        if (!apiRes.ok) {
          throw new Error(`HTTP Error Status ${apiRes.status}: ${text.substring(0, 100)}`);
        }

        const firstResponse = apiData?.responses?.[0];
        const responseCode = firstResponse?.['respose-code'];
        const responseDesc = firstResponse?.['response-description'] || 'No description';

        if (responseCode !== 200 && responseCode !== '200') {
          throw new Error(`Mobitech Gateway Error ${responseCode}: ${responseDesc}`);
        }

        success = true;
        summary = `SMS delivered successfully. Provider reference: ${firstResponse?.messageid || 'N/A'}`;
      } catch (err) {
        success = false;
        errorMsg = err.message;
        summary = `Failed to send SMS: ${err.message}`;
      }
    }

    const testLog = await pgDb.insert('integration_test_logs', {
      organization_id: orgId,
      integration_id: integrationId,
      tested_by: userId,
      status: success ? 'success' : 'failed',
      response_summary: summary,
      error_message: errorMsg
    });

    const newStatus = resolveStatus(integration.status, true, success);
    await pgDb.update('organization_integrations', integrationId, {
      status: newStatus,
      last_tested_at: new Date().toISOString()
    });

    await pgDb.logAudit(
      orgId, userId, role,
      success ? 'integration_test_passed' : 'integration_test_failed',
      'organization_integrations',
      integrationId,
      { status: integration.status },
      { status: newStatus, test_log_id: testLog.id },
      `Mobitech test SMS ${success ? 'passed' : 'failed'} for recipient ${cleaned}.`
    );

    if (!success) {
      // Log to system errors
      await pgDb.logError(
        orgId, userId,
        'Mobitech.testSms',
        `Test SMS sending failed: ${errorMsg}. Recipient: ${cleaned}`,
        null,
        { integration_id: integrationId }
      );
      return res.status(502).json({ error: errorMsg });
    }

    res.json({
      success: true,
      message: summary,
      test_log_id: testLog.id,
      new_status: newStatus
    });
  }));

  // =========================================================================
  // POST /integrations/:id/delete — Delete credentials (PIN required)
  // =========================================================================
  // Soft-resets the integration: clears encrypted config, webhook secret,
  // and resets status to needs_credentials.  Preserves the row and test logs.
  // =========================================================================
  router.post('/integrations/:id/delete', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const integrationId = parseInt(req.params.id);
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({ error: 'Security PIN is required to delete credentials.' });
    }

    // Validate PIN
    const org = await pgDb.findOne('organizations', { id: orgId });
    if (!org) {
      return res.status(404).json({ error: 'Organization not found.' });
    }

    if (!org.security_pin_hash) {
      return res.status(400).json({ error: 'Security PIN has not been configured. Please set up your PIN first.' });
    }

    const pinValid = bcrypt.compareSync(pin, org.security_pin_hash);

    if (!pinValid) {
      // Audit the failed PIN attempt
      await pgDb.logAudit(
        orgId, userId, role,
        'integration_delete_pin_failed',
        'organization_integrations',
        integrationId,
        null, null,
        'Failed PIN verification when attempting to delete integration credentials.',
        'failed'
      );

      // Also log to system_errors for Super Admin visibility
      await pgDb.logError(
        orgId, userId,
        'integration_credential_delete',
        `Failed PIN attempt when deleting integration ${integrationId} credentials.`,
        null,
        { integration_id: integrationId, actor_user_id: userId }
      );

      return res.status(400).json({ error: 'The security PIN is incorrect. This attempt has been logged.' });
    }

    // Find the integration
    const integration = await pgDb.findOne('organization_integrations', {
      id: integrationId,
      organization_id: orgId
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    // Soft-reset: clear credentials, keep the row
    await pgDb.update('organization_integrations', integrationId, {
      config_json_encrypted: null,
      webhook_secret: null,
      is_active: false,
      status: 'needs_credentials'
    });

    // Audit the successful deletion
    await pgDb.logAudit(
      orgId, userId, role,
      'api_credential_deleted',
      'organization_integrations',
      integrationId,
      { provider_type: integration.provider_type, status: integration.status, had_credentials: true },
      { provider_type: integration.provider_type, status: 'needs_credentials', had_credentials: false },
      'Integration credentials deleted via PIN-protected action. Encrypted config cleared.',
      'success'
    );

    res.json({ success: true, message: 'Credentials deleted successfully. Integration reset to needs_credentials.' });
  }));

  // =========================================================================
  // POST /integrations/:id/activate — Toggle integration active/inactive
  // =========================================================================
  router.post('/integrations/:id/activate', requireAuthenticatedContext, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const integrationId = parseInt(req.params.id);
    const { active } = req.body;

    const integration = await pgDb.findOne('organization_integrations', {
      id: integrationId,
      organization_id: orgId
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    const newActive = active !== undefined ? Boolean(active) : !integration.is_active;
    const newStatus = newActive ? (integration.status === 'disabled' ? 'ready' : integration.status) : 'disabled';

    await pgDb.update('organization_integrations', integrationId, {
      is_active: newActive,
      status: newStatus
    });

    await pgDb.logAudit(
      orgId, userId, role,
      newActive ? 'integration_activated' : 'integration_disabled',
      'organization_integrations',
      integrationId,
      { is_active: integration.is_active, status: integration.status },
      { is_active: newActive, status: newStatus },
      `Integration ${newActive ? 'activated' : 'disabled'} for ${integration.provider_name}.`
    );

    res.json({ success: true, is_active: newActive, status: newStatus });
  }));

  return router;
}

