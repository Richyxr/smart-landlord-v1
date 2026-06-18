import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultJsonPath = path.join(projectRoot, 'server', 'data', 'db.json');

const TABLE_ORDER = [
  'users',
  'organizations',
  'organization_members',
  'properties',
  'staff_assignments',
  'staff_assignment_properties',
  'units',
  'tenants',
  'invoices',
  'invoice_items',
  'transactions',
  'payment_allocations',
  'reconciliation_batches',
  'reconciliation_staging_rows',
  'archived_transactions',
  'meter_readings',
  'internal_messages',
  'service_rates',
  'organization_integrations',
  'integration_test_logs',
  'notification_settings',
  'notifications',
  'notification_logs',
  'audit_logs',
  'support_access_sessions',
  'system_audit_logs',
  'system_errors',
  'platform_billing_settings',
  'platform_billing_invoices',
  'platform_billing_payments',
  'deletion_requests',
  'maintenance_requests'
];

const JSONB_COLUMNS = new Set([
  'raw_payload',
  'raw_row_data',
  'transaction_snapshot',
  'old_values',
  'new_values',
  'metadata',
  'bank_account_details'
]);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to seed PostgreSQL.');
  process.exit(1);
}

const jsonPathArg = process.argv.find(arg => arg.startsWith('--file='));
const jsonPath = jsonPathArg ? path.resolve(jsonPathArg.slice('--file='.length)) : defaultJsonPath;
const shouldTruncate = process.argv.includes('--truncate');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

function toJsonb(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch (_error) {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

async function getTableColumns(table) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      ORDER BY ordinal_position
    `,
    [table]
  );
  return new Set(result.rows.map(row => row.column_name));
}

function normalizeRow(row, tableColumns, table) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (!tableColumns.has(key)) continue;
    normalized[key] = JSONB_COLUMNS.has(key) ? toJsonb(value) : value;
  }
  if (table === 'platform_billing_invoices' && !normalized.invoice_number) {
    normalized.invoice_number = `PLAT-INV-${String(row.id || Math.floor(Math.random()*1000000)).padStart(6, '0')}`;
  }
  return normalized;
}

async function insertRows(table, rows) {
  if (!rows || rows.length === 0) {
    return 0;
  }

  const tableColumns = await getTableColumns(table);
  if (tableColumns.size === 0) {
    console.warn(`Skipping ${table}; table does not exist in PostgreSQL schema.`);
    return 0;
  }

  let inserted = 0;
  for (const row of rows) {
    const normalized = normalizeRow(row, tableColumns, table);
    const columns = Object.keys(normalized);
    if (columns.length === 0) continue;

    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const values = columns.map(column => normalized[column]);
    const quotedColumns = columns.map(column => `"${column}"`);

    await client.query(
      `
        INSERT INTO "${table}" (${quotedColumns.join(', ')})
        VALUES (${placeholders.join(', ')})
      `,
      values
    );
    inserted += 1;
  }

  if (tableColumns.has('id')) {
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('"${table}"', 'id'),
        COALESCE((SELECT MAX(id) FROM "${table}"), 1),
        (SELECT COUNT(*) > 0 FROM "${table}")
      )
    `);
  }

  return inserted;
}

async function truncateTables() {
  const existingTables = [];
  for (const table of TABLE_ORDER) {
    const columns = await getTableColumns(table);
    if (columns.size > 0) existingTables.push(`"${table}"`);
  }

  if (existingTables.length === 0) return;
  await client.query(`TRUNCATE ${existingTables.join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));

  await client.connect();
  try {
    await client.query('BEGIN');

    if (shouldTruncate) {
      console.log('Truncating existing data...');
      await truncateTables();
    }

    for (const table of TABLE_ORDER) {
      const inserted = await insertRows(table, json[table] || []);
      if (inserted > 0) {
        console.log(`Inserted ${inserted} row(s) into ${table}.`);
      }
    }

    await client.query('COMMIT');
    console.log('JSON seed import complete.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('Seed import failed.');
  console.error(error);
  process.exit(1);
});
