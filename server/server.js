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
import { NotificationService } from './notificationService.js';

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === 'true' || (!IS_PRODUCTION && process.env.DEMO_MODE !== 'false');
const DATA_BACKEND = process.env.DATA_BACKEND || 'json';
const pgDb = DATA_BACKEND === 'postgres' ? createPostgresDb() : null;
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? null : 'smart-landlord-dev-session-secret');
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10);

const publicApiPaths = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/webhooks/payment',
  '/api/webhooks/mpesa/c2b',
  '/api/webhooks/mpesa/stk',
  '/api/webhooks/bank'
]);

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
  return req.auth?.role || (DEMO_MODE ? req.headers['x-user-role'] : null);
}

function requireAuthenticated(req, res, next) {
  if (req.auth || (DEMO_MODE && req.headers['x-user-id'])) {
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

async function attachSessionContext(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const session = verifyToken(token);
      if (!session) {
        return res.status(401).json({ error: 'INVALID_SESSION', message: 'Session is invalid or expired.' });
      }

      const user = await activeFindOne('users', { id: session.user_id });
      const organization = session.organization_id
        ? await activeFindOne('organizations', { id: session.organization_id })
        : null;

      if (!user || (session.organization_id && !organization)) {
        return res.status(401).json({ error: 'INVALID_SESSION', message: 'Session user or organization no longer exists.' });
      }

      req.auth = {
        user,
        organization,
        role: session.role,
        userId: user.id,
        organizationId: organization ? organization.id : null
      };

      // Transitional bridge while individual route handlers are migrated.
      req.headers['x-user-id'] = String(req.auth.userId);
      req.headers['x-user-role'] = req.auth.role;
      if (req.auth.organizationId) {
        req.headers['x-organization-id'] = String(req.auth.organizationId);
      }
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
    const orgId = req.headers['x-organization-id'];
    if (orgId) {
      const org = await activeFindOne('organizations', { id: parseInt(orgId) });
      if (org && org.is_locked && !req.path.startsWith('/api/saas') && !req.path.startsWith('/api/admin')) {
        return res.status(403).json({
          error: 'LOCKED',
          message: 'Your account is temporarily locked due to an overdue platform invoice. Please complete payment to restore access.'
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

app.use(attachSessionContext);
app.use(checkOrganizationLock);

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

  const resolvedRole = member ? member.role : (user.email.includes('admin') ? 'super_admin' : 'landlord');
  const authToken = createSessionToken(user, resolvedRole, org);

  db.logAudit(org ? org.id : null, user.id, resolvedRole || requestedRole || 'unknown', 'login', 'user', user.id, null, null, 'User logged in successfully', 'success');

  res.json({
    user,
    role: resolvedRole,
    organization: org,
    auth_token: authToken
  });
});

// Register Landlord (Individual/Company)
app.post('/api/auth/register', (req, res) => {
  if (!DEMO_MODE) {
    return res.status(503).json({
      error: 'MOCK_REGISTRATION_DISABLED',
      message: 'Mock registration is disabled outside demo mode. Configure verified email and phone registration before launch.'
    });
  }

  const { name, email, phone_number, country, billing_currency, type, registration_number, tax_identifier } = req.body;

  // Verify email/phone duplicates
  const existingUser = db.findOne('users', { email });
  if (existingUser) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  // 1. Create user
  const user = db.insert('users', {
    email,
    email_verified: true, // Auto-verified in demo
    phone_number,
    phone_verified: true, // Auto-verified in demo
    name,
    status: 'active'
  });

  // 2. Create organization
  const orgName = type === 'company' ? name : `${name}'s Rental Org`;
  const org = db.insert('organizations', {
    owner_user_id: user.id,
    name: orgName,
    type,
    registration_number: registration_number || '',
    tax_identifier: tax_identifier || '',
    email,
    phone_number,
    country: country || 'Kenya',
    billing_currency: billing_currency || 'KES',
    subscription_tier: 'standard',
    subscription_status: 'active',
    is_locked: false,
    security_pin_hash: '', // Set later
    status: 'active'
  });

  // 3. Create organization member
  db.insert('organization_members', {
    organization_id: org.id,
    user_id: user.id,
    role: 'landlord',
    status: 'active'
  });

  // 4. Create default notification settings
  db.insert('notification_settings', {
    organization_id: org.id,
    rent_reminders_enabled: true,
    reminder_days_before_due: 3,
    payment_confirmation_enabled: true,
    unmatched_payment_alert_enabled: true,
    meter_reading_alert_enabled: true,
    billing_alerts_enabled: true,
    sms_provider: 'None'
  });

  db.logAudit(org.id, user.id, 'landlord', 'register_landlord', 'organization', org.id, null, { org_id: org.id, name: org.name });
  const authToken = createSessionToken(user, 'landlord', org);

  res.status(201).json({
    user,
    role: 'landlord',
    organization: org,
    auth_token: authToken
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
  app.use('/api', createPropertyRoutes(pgDb));
  app.use('/api', createFinancialRoutes(pgDb));
  app.use('/api', createReconciliationRoutes(pgDb));
  app.use('/api', createWebhookRoutes(pgDb, { demoMode: DEMO_MODE }));
  app.use('/api', createIntegrationRoutes(pgDb));
}

// Mount notification routes (supports both PostgreSQL and JSON DB backends)
app.use('/api', createNotificationRoutes(pgDb));

// Mount platform billing and admin routes (supports both PostgreSQL and JSON DB backends)
app.use('/api', createSaasBillingRoutes(pgDb, {
  demoMode: DEMO_MODE,
  sessionSecret: SESSION_SECRET,
  sessionTtlSeconds: SESSION_TTL_SECONDS,
  createSessionToken
}));

// --- PROPERTIES / UNITS / TENANTS API ---

// Properties
app.get('/api/properties', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { name, property_type, location, county, town, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const propId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];
  const oldVal = db.findOne('properties', { id: propId, organization_id: orgId });

  const updated = db.update('properties', { id: propId, organization_id: orgId }, req.body);
  
  db.logAudit(orgId, userId, role, 'property_updated', 'property', propId, oldVal, updated[0]);
  res.json(updated[0]);
});

app.delete('/api/properties/:id', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const propId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const propertyId = req.query.property_id ? parseInt(req.query.property_id) : null;
  const role = req.headers['x-user-role'];
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { property_id, unit_code, unit_type, rent_amount, deposit_amount, floor, block, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const unitId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];
  const oldVal = db.findOne('units', { id: unitId, organization_id: orgId });

  const updated = db.update('units', { id: unitId, organization_id: orgId }, req.body);
  
  db.logAudit(orgId, userId, role, 'unit_updated', 'unit', unitId, oldVal, updated[0]);
  res.json(updated[0]);
});

app.delete('/api/units/:id', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const unitId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  const oldVal = db.findOne('units', { id: unitId, organization_id: orgId });
  db.update('units', { id: unitId, organization_id: orgId }, { deleted_at: new Date().toISOString(), status: 'inactive' });
  db.update('tenants', { unit_id: unitId, organization_id: orgId }, { status: 'inactive', move_out_date: new Date().toISOString().split('T')[0] });

  db.logAudit(orgId, userId, role, 'unit_deleted', 'unit', unitId, oldVal, null);
  res.json({ success: true });
});

// Tenants
app.get('/api/tenants', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { property_id, unit_id, full_name, phone_number, email, id_number, move_in_date, rent_amount, billing_day, emergency_contact_name, emergency_contact_phone, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const tenantId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const tenantId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { tenant_id, invoice_type, issue_date, due_date, items, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const invoiceId = parseInt(req.params.id);
  const { items, notes, due_date, issue_date, invoice_type } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const orgId = parseInt(req.headers['x-organization-id']);
  const invoiceId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const invoiceId = parseInt(req.params.id);
  const { pin } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const invoiceId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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

  // Build channel-appropriate message
  let message;
  if (channel === 'sms') {
    message = `Dear ${tenant.full_name}, this is a payment reminder for invoice ${invoice.invoice_number}. Balance: KES ${invoice.balance.toLocaleString()}${overdueNote}. Due: ${invoice.due_date}. Pay via Paybill 174379, Acct: ${tenant.tenant_account_number}. Thank you.`;
  } else if (channel === 'email') {
    message = `Dear ${tenant.full_name},\n\nThis is a friendly reminder that your invoice ${invoice.invoice_number} has an outstanding balance of KES ${invoice.balance.toLocaleString()}${overdueNote}.\n\nDue Date: ${invoice.due_date}\nInvoice Total: KES ${invoice.total.toLocaleString()}\nAmount Paid: KES ${invoice.amount_paid.toLocaleString()}\nBalance Due: KES ${invoice.balance.toLocaleString()}\n\nPlease make payment via:\nM-Pesa Paybill: 174379\nAccount Number: ${tenant.tenant_account_number}\n\nIf you have already made payment, please disregard this notice.\n\nWarm regards,\n${org ? org.name : 'Property Management'}`;
  } else if (channel === 'whatsapp') {
    message = `👋 Hi *${tenant.full_name}*!\n\nThis is a reminder for invoice *${invoice.invoice_number}*${overdueNote}.\n\n💰 *Balance Due:* KES ${invoice.balance.toLocaleString()}\n📅 *Due Date:* ${invoice.due_date}\n\nPay easily via M-Pesa:\n📲 *Paybill:* 174379\n🔑 *Account:* ${tenant.tenant_account_number}\n\nThank you! 🙏`;
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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { tenant_id, amount, payment_method, reference_number, transaction_date, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const txId = parseInt(req.params.id);
  const { pin, reason } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { tempPath, fileName, mappings } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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

    let autoMatchedCount = 0;
    let unmatchedCount = 0;
    let duplicateCount = 0;

    const tenants = db.find('tenants', { organization_id: orgId });
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
      const dupLedger = db.findOne('transactions', { reference_number: refVal, organization_id: orgId });
      const dupStaging = db.findOne('reconciliation_staging_rows', { reference_number: refVal, organization_id: orgId });

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

      // Try Auto Matching
      let matchedTenant = null;
      let matchedInvoice = null;
      let confidence = 0;

      // 1. Match by tenant account number
      if (accVal) {
        matchedTenant = tenants.find(t => t.tenant_account_number.toLowerCase() === accVal.toLowerCase());
      }

      // 2. Match by exact invoice number in description
      if (!matchedTenant) {
        const invNumMatch = descVal.match(/INV-2026-\d+/i);
        if (invNumMatch) {
          const invNum = invNumMatch[0].toUpperCase();
          matchedInvoice = invoices.find(inv => inv.invoice_number === invNum);
          if (matchedInvoice) {
            matchedTenant = tenants.find(t => t.id === matchedInvoice.tenant_id);
            confidence = 95;
          }
        }
      }

      // 3. Match by unit code inside description
      if (!matchedTenant) {
        tenants.forEach(t => {
          const unit = db.findOne('units', { id: t.unit_id });
          if (unit && descVal.toLowerCase().includes(unit.unit_code.toLowerCase())) {
            matchedTenant = t;
            confidence = 80;
          }
        });
      }

      // 4. Match by tenant name
      if (!matchedTenant && payerVal) {
        matchedTenant = tenants.find(t => t.full_name.toLowerCase().includes(payerVal.toLowerCase()) || payerVal.toLowerCase().includes(t.full_name.toLowerCase()));
        if (matchedTenant) confidence = 70;
      }

      // If tenant found but not invoice, get oldest unpaid invoice
      if (matchedTenant && !matchedInvoice) {
        const tenantInvs = invoices.filter(inv => inv.tenant_id === matchedTenant.id);
        if (tenantInvs.length > 0) {
          matchedInvoice = tenantInvs.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
          confidence = Math.max(confidence, 90);
        } else {
          confidence = 50; // Found tenant but no pending invoices
        }
      }

      let status = 'unmatched';
      if (matchedTenant) {
        status = confidence >= 80 ? 'auto_matched' : 'needs_review';
        autoMatchedCount++;
      } else {
        unmatchedCount++;
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
        suggested_tenant_id: matchedTenant ? matchedTenant.id : null,
        suggested_unit_id: matchedTenant ? matchedTenant.unit_id : null,
        suggested_invoice_id: matchedInvoice ? matchedInvoice.id : null,
        confidence_score: confidence
      });
    });

    // Update batch status
    db.update('reconciliation_batches', batch.id, {
      status: 'reviewed',
      matched_rows: autoMatchedCount,
      unmatched_rows: unmatchedCount,
      duplicate_rows: duplicateCount
    });

    db.logAudit(orgId, userId, role, 'csv_uploaded', 'reconciliation_batch', batch.id, null, null, `Imported CSV statement: ${fileName}`);

    // Delete temp upload file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}

    res.json({ success: true, batchId: batch.id });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to process and import CSV statement rows.' });
  }
});

// Manual Match / Reconcile Staging Row (Requires PIN)
app.post('/api/reconciliation/match', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const { row_id, tenant_id, invoice_id, pin } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { row_id } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  const updated = db.update('reconciliation_staging_rows', { id: parseInt(row_id), organization_id: orgId }, {
    status: 'ignored',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString()
  });

  db.logAudit(orgId, userId, role, 'csv_row_ignored', 'reconciliation_staging_rows', row_id, null, null, `Ignored statement row: ${row_id}`);
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
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { property_id, unit_id, meter_type, current_reading, notes } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const readingId = parseInt(req.params.id);
  const { status, action_bill } = req.body; // 'approved', 'rejected'
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
      const dueDateVal = new Date(Date.now() + 5*24*60*60*1000).toISOString().split('T')[0];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { recipient_user_id, message_body, property_id, unit_id } = req.body;
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { partner_id } = req.body;
  const userId = parseInt(req.headers['x-user-id']);

  const messages = db.find('internal_messages', { organization_id: orgId, recipient_user_id: userId, sender_user_id: parseInt(partner_id), is_read: false });
  messages.forEach(msg => {
    db.update('internal_messages', msg.id, { is_read: true, read_at: new Date().toISOString() });
  });

  res.json({ success: true });
});

// --- SETTINGS, INTEGRATIONS, AUDIT & ARCHIVE ---

// Get Service Billing Rates
app.get('/api/settings/service-rates', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  let rates = db.find('service_rates', { organization_id: orgId });

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
app.put('/api/settings/service-rates', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { rates } = req.body; // Array of { service_type, label, rate, rate_type, unit_label, is_active }

  if (!Array.isArray(rates)) {
    return res.status(400).json({ error: 'rates must be an array.' });
  }

  const saved = rates.map(rateData => {
    const existing = db.findOne('service_rates', { organization_id: orgId, service_type: rateData.service_type });
    if (existing) {
      return db.update('service_rates', existing.id, {
        label: rateData.label,
        rate: parseFloat(rateData.rate),
        rate_type: rateData.rate_type,
        unit_label: rateData.unit_label,
        is_active: rateData.is_active !== false
      })[0];
    } else {
      return db.insert('service_rates', {
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
  });

  db.logAudit(orgId, userId, role, 'service_rates_updated', 'service_rates', null, null, rates, 'Landlord updated billing rates');
  res.json(saved);
});

// Delete a custom service rate (non-system services only)
app.delete('/api/settings/service-rates/:id', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const rateId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const rate = db.findOne('service_rates', { id: rateId, organization_id: orgId });
  if (!rate) return res.status(404).json({ error: 'Service rate not found.' });

  // Protect system-defined services from deletion
  const systemTypes = ['water', 'electricity', 'garbage', 'security'];
  if (systemTypes.includes(rate.service_type)) {
    return res.status(400).json({ error: 'System service rates cannot be deleted. You may disable them instead.' });
  }

  db.delete('service_rates', { id: rateId, organization_id: orgId });
  db.logAudit(orgId, userId, role, 'service_rate_deleted', 'service_rates', rateId, rate, null, `Deleted custom service: ${rate.label}`);

  res.json({ success: true });
});

// Integrations list
app.get('/api/integrations', (req, res) => {

  const orgId = parseInt(req.headers['x-organization-id']);
  const list = db.find('organization_integrations', { organization_id: orgId });
  res.json(list);
});

// Save integration connection
app.post('/api/integrations', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const { provider_type, provider_name, environment, config_json } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  // Encrypt simulation: Mask credentials
  const maskedConfig = {};
  for (const key in config_json) {
    maskedConfig[key] = config_json[key].length > 4 ? config_json[key].substring(0, 2) + '********' : '********';
  }

  const existing = db.findOne('organization_integrations', { provider_type, organization_id: orgId });
  let integration;

  if (existing) {
    integration = db.update('organization_integrations', existing.id, {
      provider_name,
      environment,
      config_json_encrypted: JSON.stringify(maskedConfig),
      status: 'ready',
      updated_at: new Date().toISOString()
    })[0];
  } else {
    integration = db.insert('organization_integrations', {
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

  db.logAudit(orgId, userId, role, 'integration_added', 'organization_integrations', integration.id, existing, integration);
  res.json(integration);
});

// Test Connection
app.post('/api/integrations/:id/test', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const integrationId = parseInt(req.params.id);
  const userId = parseInt(req.headers['x-user-id']);

  const integration = db.findOne('organization_integrations', { id: integrationId, organization_id: orgId });
  if (!integration) return res.status(404).json({ error: 'Integration not found.' });

  // Simulate test connection
  const success = Math.random() > 0.05; // 95% success rate for simulation

  const testLog = db.insert('integration_test_logs', {
    organization_id: orgId,
    integration_id: integrationId,
    tested_by: userId,
    status: success ? 'success' : 'failed',
    response_summary: success ? '200 OK Connection established. Webhook responds.' : '504 Gateway Timeout connecting to Sandbox provider API.',
    error_message: success ? null : 'Sandbox endpoint did not return validation challenge.'
  });

  db.update('organization_integrations', integrationId, {
    status: success ? 'ready' : 'test_failed',
    last_tested_at: new Date().toISOString()
  });

  res.json(testLog);
});

// Delete credentials (Requires PIN)
app.post('/api/integrations/:id/delete', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const integrationId = parseInt(req.params.id);
  const { pin } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  const org = db.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const integration = db.findOne('organization_integrations', { id: integrationId, organization_id: orgId });
  if (!integration) return res.status(404).json({ error: 'Integration not found.' });

  db.delete('organization_integrations', { id: integrationId, organization_id: orgId });
  
  db.logAudit(orgId, userId, role, 'api_credential_deleted', 'organization_integrations', integrationId, integration, null, 'Deleted API keys from dashboard', 'success');

  res.json({ success: true, message: 'Credentials deleted successfully.' });
});

// Get Audit Logs (Settings)
app.get('/api/settings/audit-logs', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];

  if (role === 'caretaker') {
    return res.status(403).json({ error: 'You do not have permission to access this financial feature.' });
  }

  const logs = db.find('audit_logs', { organization_id: orgId });
  const users = db.get('users');

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
app.get('/api/settings/readiness', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const org = db.findOne('organizations', { id: orgId });

  if (!org) return res.status(404).json({ error: 'Org not found' });

  const props = db.find('properties', { organization_id: orgId, deleted_at: null });
  const units = db.find('units', { organization_id: orgId, deleted_at: null });
  const tenants = db.find('tenants', { organization_id: orgId, deleted_at: null });
  const integrations = db.find('organization_integrations', { organization_id: orgId });
  const pinSet = org.security_pin_hash ? true : false;

  const checklist = {
    profile_complete: org.registration_number || org.tax_identifier ? true : false,
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

// Financial Archive (Requires PIN)
app.post('/api/settings/archive', (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const { pin, before_date, reason } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

  const org = db.findOne('organizations', { id: orgId });
  if (!org || !bcrypt.compareSync(pin, org.security_pin_hash)) {
    return res.status(400).json({ error: 'Wrong security PIN.' });
  }

  const txs = db.find('transactions', { organization_id: orgId, status: 'reconciled' });
  const toArchive = txs.filter(t => new Date(t.transaction_date) < new Date(before_date));

  toArchive.forEach(tx => {
    // 1. Move to archived
    db.insert('archived_transactions', {
      original_transaction_id: tx.id,
      organization_id: orgId,
      archived_by: userId,
      archive_reason: reason || 'Manual clean-up',
      archived_at: new Date().toISOString(),
      transaction_snapshot: JSON.stringify(tx)
    });
    
    // 2. Mark ledger status
    db.update('transactions', tx.id, { status: 'archived' });
  });

  db.logAudit(orgId, userId, role, 'financial_archive_move', 'transactions', null, { before_date, count: toArchive.length }, null, `Archived ${toArchive.length} transactions before ${before_date}`, 'success');

  res.json({ success: true, count: toArchive.length });
});

// --- COMPLIANCE & DELETION REQUESTS API ---

// Request Account / Data Deletion (Landlord)
app.post('/api/compliance/delete-request', async (req, res) => {
  const orgId = parseInt(req.headers['x-organization-id']);
  const { reason, target_type, target_tenant_id } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
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
  const userId = parseInt(req.headers['x-user-id'] || '1');
  const role = req.headers['x-user-role'] || 'super_admin';

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const role = req.headers['x-user-role'];
  const userId = parseInt(req.headers['x-user-id']);

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const { property_id, unit_id, title, description, priority, assigned_to_user_id } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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
  const orgId = parseInt(req.headers['x-organization-id']);
  const reqId = parseInt(req.params.id);
  const { status, description, estimated_cost, actual_cost } = req.body;
  const userId = parseInt(req.headers['x-user-id']);
  const role = req.headers['x-user-role'];

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

// Serve and listen
app.listen(PORT, () => {
  console.log(`Smart Landlord Backend Server running on http://localhost:${PORT}`);
});
