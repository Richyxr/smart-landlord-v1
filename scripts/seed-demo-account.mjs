import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const jsonDbPath = path.join(projectRoot, 'server', 'data', 'db.json');

export const DEMO_CONFIG = {
  orgId: 'org-demo-1001',
  orgAccount: 'ACC-DEMO-001',
  orgName: 'Demo Estates Ltd',
  landlordId: 'user-demo-landlord',
  landlordEmail: 'demo.landlord@smartlandlord.co.ke',
  landlordPassword: 'DemoLandlord123!',
  caretakerId: 'user-demo-caretaker',
  caretakerPhone: '+254711000999',
  caretakerPin: '839201',
  caretakerEmail: 'demo.caretaker@smartlandlord.co.ke'
};

export async function seedDemoData() {
  console.log('🚀 Seeding Isolated Demo Account Data...');

  const passwordHash = await bcrypt.hash(DEMO_CONFIG.landlordPassword, 10);
  const pinHash = await bcrypt.hash(DEMO_CONFIG.caretakerPin, 10);

  // Demo Organization
  const demoOrg = {
    id: DEMO_CONFIG.orgId,
    account_number: DEMO_CONFIG.orgAccount,
    name: DEMO_CONFIG.orgName,
    is_demo: true,
    created_at: new Date().toISOString()
  };

  // Users
  const demoUsers = [
    {
      id: DEMO_CONFIG.landlordId,
      email: DEMO_CONFIG.landlordEmail,
      password_hash: passwordHash,
      full_name: 'Demo Landlord',
      role: 'owner',
      phone_number: '+254700000000',
      is_super_admin: false,
      created_at: new Date().toISOString()
    },
    {
      id: DEMO_CONFIG.caretakerId,
      email: DEMO_CONFIG.caretakerEmail,
      phone_number: DEMO_CONFIG.caretakerPhone,
      full_name: 'Francis Caretaker',
      role: 'caretaker',
      security_pin_hash: pinHash,
      created_at: new Date().toISOString()
    }
  ];

  // Organization Members
  const demoMembers = [
    { id: 'mem-demo-1', organization_id: DEMO_CONFIG.orgId, user_id: DEMO_CONFIG.landlordId, role: 'owner', created_at: new Date().toISOString() },
    { id: 'mem-demo-2', organization_id: DEMO_CONFIG.orgId, user_id: DEMO_CONFIG.caretakerId, role: 'caretaker', created_at: new Date().toISOString() }
  ];

  // Properties
  const demoProperties = [
    { id: 'prop-demo-1', organization_id: DEMO_CONFIG.orgId, name: 'Mzee Moja Heights', address: 'Kilimani, Nairobi', property_code: 'MMH', created_at: new Date().toISOString() },
    { id: 'prop-demo-2', organization_id: DEMO_CONFIG.orgId, name: 'Sunrise Apartments', address: 'Westlands, Nairobi', property_code: 'SRA', created_at: new Date().toISOString() }
  ];

  // Units
  const demoUnits = [
    { id: 'unit-demo-a1', organization_id: DEMO_CONFIG.orgId, property_id: 'prop-demo-1', unit_code: 'A1', unit_type: '2 Bedroom', rent_amount: 6000, status: 'occupied', created_at: new Date().toISOString() },
    { id: 'unit-demo-a2', organization_id: DEMO_CONFIG.orgId, property_id: 'prop-demo-1', unit_code: 'A2', unit_type: '1 Bedroom', rent_amount: 15000, status: 'vacant', created_at: new Date().toISOString() },
    { id: 'unit-demo-a3', organization_id: DEMO_CONFIG.orgId, property_id: 'prop-demo-1', unit_code: 'A3', unit_type: '3 Bedroom Penthouse', rent_amount: 24000, status: 'occupied', created_at: new Date().toISOString() },
    { id: 'unit-demo-b1', organization_id: DEMO_CONFIG.orgId, property_id: 'prop-demo-2', unit_code: 'B1', unit_type: 'Commercial Suite', rent_amount: 35000, status: 'vacant', created_at: new Date().toISOString() },
    { id: 'unit-demo-b2', organization_id: DEMO_CONFIG.orgId, property_id: 'prop-demo-2', unit_code: 'B2', unit_type: '1 Bedroom Executive', rent_amount: 18000, status: 'occupied', created_at: new Date().toISOString() }
  ];

  // Tenants
  const demoTenants = [
    {
      id: 'tenant-demo-1',
      organization_id: DEMO_CONFIG.orgId,
      unit_id: 'unit-demo-a1',
      full_name: 'Master',
      phone_number: '+254723456789',
      email: 'master@demo.com',
      tenant_account_number: 'ACC-11-A1',
      unit_code: 'A1',
      property_name: 'Mzee Moja Heights',
      rent_amount: 6000,
      balance: 18000,
      status: 'active',
      move_in_date: '2026-06-21T00:00:00.000Z',
      billing_day: 1,
      last_rent_invoice_date: '2026-07-31T00:00:00.000Z',
      created_at: new Date().toISOString()
    },
    {
      id: 'tenant-demo-2',
      organization_id: DEMO_CONFIG.orgId,
      unit_id: 'unit-demo-a3',
      full_name: 'Richard Nzioka',
      phone_number: '+254727845794',
      email: 'richyrichie@gmail.com',
      tenant_account_number: 'ACC-11-A3',
      unit_code: 'A3',
      property_name: 'Mzee Moja Heights',
      rent_amount: 24000,
      balance: 24000,
      status: 'active',
      move_in_date: '2026-06-24T00:00:00.000Z',
      billing_day: 1,
      last_rent_invoice_date: '2026-06-28T00:00:00.000Z',
      created_at: new Date().toISOString()
    },
    {
      id: 'tenant-demo-3',
      organization_id: DEMO_CONFIG.orgId,
      unit_id: 'unit-demo-b2',
      full_name: 'Wanjiku Kamau',
      phone_number: '+254712999888',
      email: 'wanjiku@demo.com',
      tenant_account_number: 'ACC-11-B2',
      unit_code: 'B2',
      property_name: 'Sunrise Apartments',
      rent_amount: 18000,
      balance: 0,
      status: 'active',
      move_in_date: '2026-01-10T00:00:00.000Z',
      billing_day: 1,
      last_rent_invoice_date: '2026-08-01T00:00:00.000Z',
      created_at: new Date().toISOString()
    }
  ];

  // Invoices
  const demoInvoices = [
    {
      id: 'inv-demo-1',
      organization_id: DEMO_CONFIG.orgId,
      tenant_id: 'tenant-demo-1',
      unit_id: 'unit-demo-a1',
      invoice_number: 'INV-DEMO-001',
      tenant_name: 'Master',
      unit_code: 'A1',
      tenant_account_number: 'ACC-11-A1',
      amount: 6000,
      amount_paid: 0,
      status: 'unpaid',
      description: 'Rent - Unit A1 (August 2026)',
      due_date: '2026-08-05',
      created_at: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'inv-demo-2',
      organization_id: DEMO_CONFIG.orgId,
      tenant_id: 'tenant-demo-2',
      unit_id: 'unit-demo-a3',
      invoice_number: 'INV-DEMO-002',
      tenant_name: 'Richard Nzioka',
      unit_code: 'A3',
      tenant_account_number: 'ACC-11-A3',
      amount: 24000,
      amount_paid: 0,
      status: 'unpaid',
      description: 'Rent - Unit A3 (August 2026)',
      due_date: '2026-08-05',
      created_at: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'inv-demo-3',
      organization_id: DEMO_CONFIG.orgId,
      tenant_id: 'tenant-demo-3',
      unit_id: 'unit-demo-b2',
      invoice_number: 'INV-DEMO-003',
      tenant_name: 'Wanjiku Kamau',
      unit_code: 'B2',
      tenant_account_number: 'ACC-11-B2',
      amount: 18000,
      amount_paid: 18000,
      status: 'paid',
      description: 'Rent - Unit B2 (August 2026)',
      due_date: '2026-08-05',
      created_at: '2026-08-01T00:00:00.000Z'
    }
  ];

  // Meter Readings
  const demoMeterReadings = [
    {
      id: 'meter-demo-1',
      organization_id: DEMO_CONFIG.orgId,
      unit_id: 'unit-demo-a1',
      unit_code: 'A1',
      property_name: 'Mzee Moja Heights',
      tenant_name: 'Master',
      meter_type: 'water',
      previous_reading: 120,
      current_reading: 135,
      reading_date: '2026-08-01',
      recorded_by: DEMO_CONFIG.caretakerId,
      created_at: new Date().toISOString()
    },
    {
      id: 'meter-demo-2',
      organization_id: DEMO_CONFIG.orgId,
      unit_id: 'unit-demo-a3',
      unit_code: 'A3',
      property_name: 'Mzee Moja Heights',
      tenant_name: 'Richard Nzioka',
      meter_type: 'water',
      previous_reading: 210,
      current_reading: 232,
      reading_date: '2026-08-01',
      recorded_by: DEMO_CONFIG.caretakerId,
      created_at: new Date().toISOString()
    }
  ];

  // Staff Assignments
  const demoStaffAssignments = [
    {
      id: 'staff-demo-1',
      organization_id: DEMO_CONFIG.orgId,
      user_id: DEMO_CONFIG.caretakerId,
      assigned_properties: ['prop-demo-1', 'prop-demo-2'],
      created_at: new Date().toISOString()
    }
  ];

  // Update PostgreSQL if DATABASE_URL exists
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();

      // Clean up previous demo org data cleanly
      await client.query(`DELETE FROM staff_assignments WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM meter_readings WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM invoices WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM tenants WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM units WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM properties WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM organization_members WHERE organization_id = $1`, [DEMO_CONFIG.orgId]);
      await client.query(`DELETE FROM users WHERE id IN ($1, $2)`, [DEMO_CONFIG.landlordId, DEMO_CONFIG.caretakerId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [DEMO_CONFIG.orgId]);

      // Insert Demo Org
      await client.query(
        `INSERT INTO organizations (id, account_number, name, is_demo, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [demoOrg.id, demoOrg.account_number, demoOrg.name, demoOrg.is_demo, demoOrg.created_at]
      );

      // Insert Users
      for (const u of demoUsers) {
        await client.query(
          `INSERT INTO users (id, email, password_hash, security_pin_hash, full_name, role, phone_number, is_super_admin, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [u.id, u.email, u.password_hash || null, u.security_pin_hash || null, u.full_name, u.role, u.phone_number, u.is_super_admin || false, u.created_at]
        );
      }

      // Insert Members
      for (const m of demoMembers) {
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [m.id, m.organization_id, m.user_id, m.role, m.created_at]
        );
      }

      // Insert Properties
      for (const p of demoProperties) {
        await client.query(
          `INSERT INTO properties (id, organization_id, name, address, property_code, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [p.id, p.organization_id, p.name, p.address, p.property_code, p.created_at]
        );
      }

      // Insert Units
      for (const un of demoUnits) {
        await client.query(
          `INSERT INTO units (id, organization_id, property_id, unit_code, unit_type, rent_amount, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [un.id, un.organization_id, un.property_id, un.unit_code, un.unit_type, un.rent_amount, un.status, un.created_at]
        );
      }

      // Insert Tenants
      for (const t of demoTenants) {
        await client.query(
          `INSERT INTO tenants (id, organization_id, unit_id, full_name, phone_number, email, tenant_account_number, unit_code, property_name, rent_amount, balance, status, move_in_date, billing_day, last_rent_invoice_date, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [t.id, t.organization_id, t.unit_id, t.full_name, t.phone_number, t.email, t.tenant_account_number, t.unit_code, t.property_name, t.rent_amount, t.balance, t.status, t.move_in_date, t.billing_day, t.last_rent_invoice_date, t.created_at]
        );
      }

      // Insert Invoices
      for (const inv of demoInvoices) {
        await client.query(
          `INSERT INTO invoices (id, organization_id, tenant_id, unit_id, invoice_number, tenant_name, unit_code, tenant_account_number, amount, amount_paid, status, description, due_date, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [inv.id, inv.organization_id, inv.tenant_id, inv.unit_id, inv.invoice_number, inv.tenant_name, inv.unit_code, inv.tenant_account_number, inv.amount, inv.amount_paid, inv.status, inv.description, inv.due_date, inv.created_at]
        );
      }

      // Insert Meter Readings
      for (const mr of demoMeterReadings) {
        await client.query(
          `INSERT INTO meter_readings (id, organization_id, unit_id, unit_code, property_name, tenant_name, meter_type, previous_reading, current_reading, reading_date, recorded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [mr.id, mr.organization_id, mr.unit_id, mr.unit_code, mr.property_name, mr.tenant_name, mr.meter_type, mr.previous_reading, mr.current_reading, mr.reading_date, mr.recorded_by, mr.created_at]
        );
      }

      // Insert Staff Assignments
      for (const sa of demoStaffAssignments) {
        await client.query(
          `INSERT INTO staff_assignments (id, organization_id, user_id, assigned_properties, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [sa.id, sa.organization_id, sa.user_id, JSON.stringify(sa.assigned_properties), sa.created_at]
        );
      }

      console.log('✅ Demo account seeded into PostgreSQL successfully.');
    } catch (err) {
      console.warn('⚠️ PostgreSQL seed error:', err.message);
    } finally {
      await client.end();
    }
  }

  // Update JSON DB fallback if db.json exists
  try {
    const rawJson = await fs.readFile(jsonDbPath, 'utf8');
    const db = JSON.parse(rawJson);

    // Filter out previous demo data
    const filterOutDemo = (arr) => (Array.isArray(arr) ? arr.filter((item) => item.organization_id !== DEMO_CONFIG.orgId && item.id !== DEMO_CONFIG.orgId && item.id !== DEMO_CONFIG.landlordId && item.id !== DEMO_CONFIG.caretakerId) : []);

    db.organizations = [...filterOutDemo(db.organizations), demoOrg];
    db.users = [...filterOutDemo(db.users), ...demoUsers];
    db.organization_members = [...filterOutDemo(db.organization_members), ...demoMembers];
    db.properties = [...filterOutDemo(db.properties), ...demoProperties];
    db.units = [...filterOutDemo(db.units), ...demoUnits];
    db.tenants = [...filterOutDemo(db.tenants), ...demoTenants];
    db.invoices = [...filterOutDemo(db.invoices), ...demoInvoices];
    db.meter_readings = [...filterOutDemo(db.meter_readings), ...demoMeterReadings];
    db.staff_assignments = [...filterOutDemo(db.staff_assignments), ...demoStaffAssignments];

    await fs.writeFile(jsonDbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log('✅ Demo account seeded into db.json fallback successfully.');
  } catch (err) {
    console.warn('⚠️ JSON DB seed error:', err.message);
  }

  console.log('🎉 Isolated Demo Account Ready!');
  console.log(`   Landlord Login: ${DEMO_CONFIG.landlordEmail} / ${DEMO_CONFIG.landlordPassword}`);
  console.log(`   Caretaker Login: ${DEMO_CONFIG.caretakerPhone} / PIN: ${DEMO_CONFIG.caretakerPin}`);
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed-demo-account.mjs')) {
  seedDemoData().catch(console.error);
}
