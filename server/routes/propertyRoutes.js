import express from 'express';

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
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

  router.use(requireAuthenticatedContext);

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

