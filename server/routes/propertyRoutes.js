import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const CARETAKER_PIN_PATTERN = /^\d{6}$/;

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

  next();
}

async function getCaretakerPropertyIds(pgDb, orgId, userId) {
  const result = await pgDb.query(
    `
      SELECT sap.property_id
      FROM staff_assignments sa
      JOIN staff_assignment_properties sap
        ON sap.staff_assignment_id = sa.id
       AND sap.organization_id = sa.organization_id
      WHERE sa.organization_id = $1
        AND sa.caretaker_user_id = $2
        AND sa.status = 'active'
    `,
    [orgId, userId]
  );

  return result.rows.map(row => row.property_id);
}

function requireLandlord(req, res, next) {
  const { role } = getContext(req);
  if (role !== 'landlord') {
    return res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Only landlords can modify property, unit, and tenant records.'
    });
  }
  next();
}

export function createPropertyRoutes(pgDb) {
  const router = express.Router();

  router.use(['/properties', '/units', '/tenants'], requireAuthenticatedContext);

  router.get('/properties/caretakers', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);

    // Get all caretakers in this organization
    const result = await pgDb.query(`
      SELECT u.id, u.name, u.email, u.phone_number, om.status AS status
      FROM organization_members om
      JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1 AND om.role = 'caretaker' AND om.status IN ('active', 'disabled')
    `, [orgId]);
    const caretakers = result.rows;

    // Get all property assignments for caretakers in this organization
    const assignmentsResult = await pgDb.query(`
      SELECT sa.caretaker_user_id, p.id AS property_id, p.name AS property_name
      FROM staff_assignments sa
      JOIN staff_assignment_properties sap ON sap.staff_assignment_id = sa.id AND sap.organization_id = sa.organization_id
      JOIN properties p ON p.id = sap.property_id AND p.organization_id = sa.organization_id
      WHERE sa.organization_id = $1 AND p.organization_id = $1 AND p.deleted_at IS NULL
    `, [orgId]);
    const assignments = assignmentsResult.rows;

    const caretakersWithProps = caretakers.map(ct => {
      const ctProps = assignments
        .filter(a => Number(a.caretaker_user_id) === Number(ct.id))
        .map(a => ({ id: a.property_id, name: a.property_name }));
      return {
        ...ct,
        properties: ctProps
      };
    });

    res.json(caretakersWithProps);
  }));

  router.post('/properties/caretakers', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { name, email, phone_number, assigned_properties, pin: requestedPin } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    // Check if caretaker already exists by phone number
    let user = await pgDb.findOne('users', { phone_number });
    if (user) {
      const existingMembership = await pgDb.findOne('organization_members', { user_id: user.id });
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

    if (uniquePropIds.length > 0) {
      const propCheckResult = await pgDb.query(
        `SELECT id FROM properties WHERE organization_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
        [orgId, uniquePropIds]
      );
      const validatedIds = propCheckResult.rows.map(row => Number(row.id));
      if (validatedIds.length !== uniquePropIds.length) {
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
      user = await pgDb.insert('users', {
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
      await pgDb.update('users', user.id, {
        caretaker_pin_hash: pinHash,
        caretaker_failed_login_attempts: 0,
        caretaker_locked_until: null,
        caretaker_last_failed_login_at: null
      });
      user = await pgDb.findOne('users', { id: user.id });
    }

    // Create organization member
    await pgDb.insert('organization_members', {
      organization_id: orgId,
      user_id: user.id,
      role: 'caretaker',
      status: 'active'
    });

    // Create staff assignment
    const assignment = await pgDb.insert('staff_assignments', {
      organization_id: orgId,
      caretaker_user_id: user.id,
      access_level: 'caretaker',
      status: 'active',
      created_by: userId
    });

    // Create property links
    for (const propId of uniquePropIds) {
      await pgDb.insert('staff_assignment_properties', {
        organization_id: orgId,
        staff_assignment_id: assignment.id,
        property_id: propId
      });
    }

    await pgDb.logAudit(orgId, userId, role, 'caretaker_created', 'user', user.id, null, { id: user.id, name: user.name });

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
  }));

  router.put('/properties/caretakers/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const caretakerId = parseInt(req.params.id, 10);

    // Verify caretaker belongs to this organization
    const member = await pgDb.findOne('organization_members', { organization_id: orgId, user_id: caretakerId, role: 'caretaker' });
    if (!member) {
      return res.status(404).json({ error: 'Caretaker not found in this organization.' });
    }

    const { name, phone_number, email, status, assigned_properties, pin } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    // Check if phone number is already registered to another user
    const existingUser = await pgDb.findOne('users', { phone_number });
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

    if (uniquePropIds.length > 0) {
      const propCheckResult = await pgDb.query(
        `SELECT id FROM properties WHERE organization_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
        [orgId, uniquePropIds]
      );
      const validatedIds = propCheckResult.rows.map(row => Number(row.id));
      if (validatedIds.length !== uniquePropIds.length) {
        return res.status(400).json({ error: 'One or more selected properties are invalid.' });
      }
    }

    // Perform updates
    const oldUser = await pgDb.findOne('users', { id: caretakerId });
    const updateFields = { name, phone_number };
    if (email !== undefined) {
      updateFields.email = email || null;
    }
    if (status && ['active', 'disabled'].includes(status)) {
      updateFields.status = status;
    }
    if (pin !== undefined) {
      const nextPin = String(pin);
      if (!isValidCaretakerPin(nextPin)) {
        return res.status(400).json({ error: 'Caretaker PIN must be exactly 6 numeric digits.' });
      }
      const salt = bcrypt.genSaltSync(10);
      updateFields.caretaker_pin_hash = bcrypt.hashSync(nextPin, salt);
      updateFields.caretaker_failed_login_attempts = 0;
      updateFields.caretaker_locked_until = null;
      updateFields.caretaker_last_failed_login_at = null;
    }
    const [updatedUser] = await pgDb.update('users', { id: caretakerId }, updateFields);

    if (status && ['active', 'disabled'].includes(status)) {
      await pgDb.update('organization_members', { organization_id: orgId, user_id: caretakerId, role: 'caretaker' }, { status });
      await pgDb.update('staff_assignments', { organization_id: orgId, caretaker_user_id: caretakerId }, { status });
    }

    // Get current staff assignment
    let assignment = await pgDb.findOne('staff_assignments', { organization_id: orgId, caretaker_user_id: caretakerId });
    if (!assignment) {
      assignment = await pgDb.insert('staff_assignments', {
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
      await pgDb.update('staff_assignments', assignment.id, updateAssignment);
    }

    // Remove old property links and insert new ones
    await pgDb.delete('staff_assignment_properties', { staff_assignment_id: assignment.id, organization_id: orgId });

    for (const propId of uniquePropIds) {
      await pgDb.insert('staff_assignment_properties', {
        organization_id: orgId,
        staff_assignment_id: assignment.id,
        property_id: propId
      });
    }

    await pgDb.logAudit(orgId, userId, role, 'caretaker_updated', 'user', caretakerId, oldUser, updatedUser);

    res.json({ success: true, user: updatedUser });
  }));

  router.post('/properties/caretakers/:id/reset-pin', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const caretakerId = parseInt(req.params.id, 10);
    const { pin: requestedPin } = req.body || {};

    // Verify caretaker belongs to this organization
    const member = await pgDb.findOne('organization_members', { organization_id: orgId, user_id: caretakerId, role: 'caretaker' });
    if (!member) {
      return res.status(404).json({ error: 'Caretaker not found in this organization.' });
    }

    const pin = requestedPin !== undefined ? String(requestedPin) : generateCaretakerPin();
    if (!isValidCaretakerPin(pin)) {
      return res.status(400).json({ error: 'Caretaker PIN must be exactly 6 numeric digits.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const pinHash = bcrypt.hashSync(pin, salt);

    const oldUser = await pgDb.findOne('users', { id: caretakerId });
    const [updatedUser] = await pgDb.update('users', { id: caretakerId }, {
      caretaker_pin_hash: pinHash,
      caretaker_failed_login_attempts: 0,
      caretaker_locked_until: null,
      caretaker_last_failed_login_at: null
    });

    await pgDb.logAudit(orgId, userId, role, 'caretaker_pin_reset', 'user', caretakerId, null, null, 'Caretaker PIN reset');

    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        phone_number: updatedUser.phone_number
      }
    });
  }));

  router.get('/properties', asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    let properties = await pgDb.find('properties', { organization_id: orgId, deleted_at: null });

    if (role === 'caretaker') {
      const assignedPropertyIds = await getCaretakerPropertyIds(pgDb, orgId, userId);
      properties = properties.filter(property => assignedPropertyIds.includes(property.id));
    }

    const propertyIds = properties.map(property => property.id);
    if (propertyIds.length === 0) {
      return res.json([]);
    }

    const stats = await pgDb.query(
      `
        SELECT
          p.id AS property_id,
          COUNT(u.id)::int AS total_units,
          COUNT(*) FILTER (WHERE u.status = 'vacant')::int AS vacant_units,
          COUNT(*) FILTER (WHERE u.status = 'occupied')::int AS occupied_units,
          COUNT(*) FILTER (WHERE u.status = 'under_maintenance')::int AS maintenance_units,
          COALESCE(SUM(u.rent_amount), 0)::numeric AS expected_rent,
          COALESCE(SUM(i.amount_paid) FILTER (WHERE i.status = 'paid'), 0)::numeric AS collected_rent,
          COALESCE(SUM(i.balance) FILTER (WHERE i.status IN ('overdue', 'partially_paid')), 0)::numeric AS arrears
        FROM properties p
        LEFT JOIN units u
          ON u.property_id = p.id
         AND u.organization_id = p.organization_id
         AND u.deleted_at IS NULL
        LEFT JOIN invoices i
          ON i.property_id = p.id
         AND i.organization_id = p.organization_id
        WHERE p.organization_id = $1
          AND p.id = ANY($2::bigint[])
        GROUP BY p.id
      `,
      [orgId, propertyIds]
    );

    const statsByPropertyId = new Map(stats.rows.map(row => [row.property_id, row]));

    res.json(properties.map(property => ({
      ...property,
      total_units: statsByPropertyId.get(property.id)?.total_units || 0,
      vacant_units: statsByPropertyId.get(property.id)?.vacant_units || 0,
      occupied_units: statsByPropertyId.get(property.id)?.occupied_units || 0,
      maintenance_units: statsByPropertyId.get(property.id)?.maintenance_units || 0,
      expected_rent: Number(statsByPropertyId.get(property.id)?.expected_rent || 0),
      collected_rent: Number(statsByPropertyId.get(property.id)?.collected_rent || 0),
      arrears: Number(statsByPropertyId.get(property.id)?.arrears || 0)
    })));
  }));

  router.post('/properties', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { name, property_type, location, county, town, notes } = req.body;

    const property = await pgDb.insert('properties', {
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

    await pgDb.logAudit(orgId, userId, role, 'property_created', 'property', property.id, null, property);
    res.status(201).json(property);
  }));

  router.put('/properties/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const propertyId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('properties', { id: propertyId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const [updated] = await pgDb.update('properties', { id: propertyId, organization_id: orgId }, req.body);
    await pgDb.logAudit(orgId, userId, role, 'property_updated', 'property', propertyId, oldValue, updated);
    res.json(updated);
  }));

  router.delete('/properties/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const propertyId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('properties', { id: propertyId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const deletedAt = new Date().toISOString();
    await pgDb.update('properties', { id: propertyId, organization_id: orgId }, { deleted_at: deletedAt, status: 'inactive' });
    await pgDb.update('units', { property_id: propertyId, organization_id: orgId }, { deleted_at: deletedAt, status: 'inactive' });
    await pgDb.update('tenants', { property_id: propertyId, organization_id: orgId }, { status: 'inactive', move_out_date: deletedAt.slice(0, 10) });
    await pgDb.logAudit(orgId, userId, role, 'property_deleted', 'property', propertyId, oldValue, null);

    res.json({ success: true });
  }));

  router.get('/units', asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const propertyId = req.query.property_id ? parseInt(req.query.property_id) : null;
    const query = { organization_id: orgId, deleted_at: null };
    if (propertyId) query.property_id = propertyId;

    let units = await pgDb.find('units', query);
    if (role === 'caretaker') {
      const assignedPropertyIds = await getCaretakerPropertyIds(pgDb, orgId, userId);
      units = units.filter(unit => assignedPropertyIds.includes(unit.property_id));
    }

    if (units.length === 0) {
      return res.json([]);
    }

    const unitIds = units.map(unit => unit.id);
    const result = await pgDb.query(
      `
        SELECT
          u.id,
          p.name AS property_name,
          t.full_name AS tenant_name,
          t.id AS tenant_id
        FROM units u
        LEFT JOIN properties p
          ON p.id = u.property_id
         AND p.organization_id = u.organization_id
        LEFT JOIN tenants t
          ON t.unit_id = u.id
         AND t.organization_id = u.organization_id
         AND t.status = 'active'
         AND t.deleted_at IS NULL
        WHERE u.organization_id = $1
          AND u.id = ANY($2::bigint[])
      `,
      [orgId, unitIds]
    );

    const detailByUnitId = new Map(result.rows.map(row => [row.id, row]));
    res.json(units.map(unit => ({
      ...unit,
      property_name: detailByUnitId.get(unit.id)?.property_name || 'Unknown Property',
      tenant_name: detailByUnitId.get(unit.id)?.tenant_name || 'Vacant',
      tenant_id: detailByUnitId.get(unit.id)?.tenant_id || null
    })));
  }));

  router.post('/units', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { property_id, unit_code, unit_type, rent_amount, deposit_amount, floor, block, notes } = req.body;

    const property = await pgDb.findOne('properties', { id: parseInt(property_id), organization_id: orgId, deleted_at: null });
    if (!property) {
      return res.status(400).json({ error: 'Property not found.' });
    }

    const unit = await pgDb.insert('units', {
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

    await pgDb.logAudit(orgId, userId, role, 'unit_created', 'unit', unit.id, null, unit);
    res.status(201).json(unit);
  }));

  router.put('/units/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const unitId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('units', { id: unitId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const [updated] = await pgDb.update('units', { id: unitId, organization_id: orgId }, req.body);
    await pgDb.logAudit(orgId, userId, role, 'unit_updated', 'unit', unitId, oldValue, updated);
    res.json(updated);
  }));

  router.delete('/units/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const unitId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('units', { id: unitId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const deletedAt = new Date().toISOString();
    await pgDb.update('units', { id: unitId, organization_id: orgId }, { deleted_at: deletedAt, status: 'inactive' });
    await pgDb.update('tenants', { unit_id: unitId, organization_id: orgId }, { status: 'inactive', move_out_date: deletedAt.slice(0, 10) });
    await pgDb.logAudit(orgId, userId, role, 'unit_deleted', 'unit', unitId, oldValue, null);

    res.json({ success: true });
  }));

  router.get('/tenants', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId } = getContext(req);
    const tenants = await pgDb.find('tenants', { organization_id: orgId, deleted_at: null });

    if (tenants.length === 0) {
      return res.json([]);
    }

    const tenantIds = tenants.map(tenant => tenant.id);
    const result = await pgDb.query(
      `
        SELECT
          t.id,
          p.name AS property_name,
          u.unit_code,
          COALESCE(SUM(i.balance) FILTER (WHERE i.status NOT IN ('paid', 'void')), 0)::numeric AS balance,
          lp.amount AS last_payment_amount,
          lp.transaction_date AS last_payment_date
        FROM tenants t
        LEFT JOIN properties p
          ON p.id = t.property_id
         AND p.organization_id = t.organization_id
        LEFT JOIN units u
          ON u.id = t.unit_id
         AND u.organization_id = t.organization_id
        LEFT JOIN invoices i
          ON i.tenant_id = t.id
         AND i.organization_id = t.organization_id
        LEFT JOIN LATERAL (
          SELECT amount, transaction_date
          FROM transactions tx
          WHERE tx.organization_id = t.organization_id
            AND tx.tenant_id = t.id
            AND tx.transaction_type = 'payment'
            AND tx.status = 'reconciled'
          ORDER BY tx.transaction_date DESC
          LIMIT 1
        ) lp ON TRUE
        WHERE t.organization_id = $1
          AND t.id = ANY($2::bigint[])
        GROUP BY t.id, p.name, u.unit_code, lp.amount, lp.transaction_date
      `,
      [orgId, tenantIds]
    );

    const detailByTenantId = new Map(result.rows.map(row => [row.id, row]));
    res.json(tenants.map(tenant => ({
      ...tenant,
      property_name: detailByTenantId.get(tenant.id)?.property_name || 'Unknown Property',
      unit_code: detailByTenantId.get(tenant.id)?.unit_code || 'Unknown Unit',
      balance: Number(detailByTenantId.get(tenant.id)?.balance || 0),
      last_payment_amount: detailByTenantId.get(tenant.id)?.last_payment_amount || null,
      last_payment_date: detailByTenantId.get(tenant.id)?.last_payment_date || null
    })));
  }));

  router.post('/tenants', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const { property_id, unit_id, full_name, phone_number, email, id_number, move_in_date, rent_amount, billing_day, emergency_contact_name, emergency_contact_phone, notes } = req.body;

    const unit = await pgDb.findOne('units', { id: parseInt(unit_id), organization_id: orgId, property_id: parseInt(property_id), deleted_at: null });
    if (!unit) {
      return res.status(400).json({ error: 'Unit not found.' });
    }

    const randNum = Math.floor(1000 + Math.random() * 9000);
    const unitCode = unit.unit_code.replace(/[^a-zA-Z0-9]/g, '') || 'UN';
    const tenantAccountNumber = `ACC-${orgId}${property_id}-${unitCode}`;

    const tenant = await pgDb.insert('tenants', {
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

    await pgDb.update('units', { id: parseInt(unit_id), organization_id: orgId }, { status: 'occupied' });
    await pgDb.logAudit(orgId, userId, role, 'tenant_created', 'tenant', tenant.id, null, tenant);

    res.status(201).json(tenant);
  }));

  router.put('/tenants/:id', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const tenantId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('tenants', { id: tenantId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const [updated] = await pgDb.update('tenants', { id: tenantId, organization_id: orgId }, req.body);

    if (req.body.status && req.body.status !== 'active' && req.body.status !== 'notice') {
      await pgDb.update('units', { id: oldValue.unit_id, organization_id: orgId }, { status: 'vacant' });
    }

    await pgDb.logAudit(orgId, userId, role, 'tenant_updated', 'tenant', tenantId, oldValue, updated);
    res.json(updated);
  }));

  router.post('/tenants/:id/vacate', requireLandlord, asyncHandler(async (req, res) => {
    const { orgId, userId, role } = getContext(req);
    const tenantId = parseInt(req.params.id);
    const oldValue = await pgDb.findOne('tenants', { id: tenantId, organization_id: orgId });

    if (!oldValue) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const [updated] = await pgDb.update('tenants', { id: tenantId, organization_id: orgId }, {
      status: 'vacated',
      move_out_date: new Date().toISOString().slice(0, 10)
    });

    await pgDb.update('units', { id: oldValue.unit_id, organization_id: orgId }, { status: 'vacant' });
    await pgDb.logAudit(orgId, userId, role, 'tenant_vacated', 'tenant', tenantId, oldValue, updated);

    res.json(updated);
  }));

  return router;
}

