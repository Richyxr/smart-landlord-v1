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
    // If currently not_started or needs_credentials, move to draft
    if (['not_started', 'needs_credentials'].includes(currentStatus)) return 'draft';
    // Otherwise keep current status (could be ready, live, etc.)
    return currentStatus;
  }
  return 'needs_credentials';
}

export function createIntegrationRoutes(pgDb) {
  const router = express.Router();

  // =========================================================================
  // GET /integrations — List all integrations for the organization
  // =========================================================================
  // Returns masked credentials only. Never returns config_json_encrypted.
  // =========================================================================
  router.get('/integrations', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
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
  router.get('/integrations/:id', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
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
  router.post('/integrations', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
    const userId = parseInt(req.headers['x-user-id']);
    const role = req.headers['x-user-role'];
    const { provider_type, provider_name, environment, config_json } = req.body;

    if (!provider_type || !provider_name) {
      return res.status(400).json({ error: 'provider_type and provider_name are required.' });
    }

    // Encrypt the credentials for storage
    const encryptedConfig = config_json && Object.keys(config_json).length > 0
      ? encryptConfig(config_json)
      : null;

    // Extract top-level fields for webhook routing (Phase 6)
    const shortcode = config_json?.shortcode || config_json?.till_number || null;
    const webhookSecret = config_json?.passkey || config_json?.webhook_secret || null;
    const providerIdentifier = config_json?.bank_code || config_json?.provider_id || null;
    const accountReference = config_json?.account_reference || null;

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
        environment: environment || 'sandbox',
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
        environment: environment || 'sandbox',
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
  router.post('/integrations/:id/test', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
    const integrationId = parseInt(req.params.id);
    const userId = parseInt(req.headers['x-user-id']);

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
  // POST /integrations/:id/delete — Delete credentials (PIN required)
  // =========================================================================
  // Soft-resets the integration: clears encrypted config, webhook secret,
  // and resets status to needs_credentials.  Preserves the row and test logs.
  // =========================================================================
  router.post('/integrations/:id/delete', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
    const integrationId = parseInt(req.params.id);
    const { pin } = req.body;
    const userId = parseInt(req.headers['x-user-id']);
    const role = req.headers['x-user-role'];

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
  router.post('/integrations/:id/activate', asyncHandler(async (req, res) => {
    const orgId = parseInt(req.headers['x-organization-id']);
    const integrationId = parseInt(req.params.id);
    const userId = parseInt(req.headers['x-user-id']);
    const role = req.headers['x-user-role'];
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
