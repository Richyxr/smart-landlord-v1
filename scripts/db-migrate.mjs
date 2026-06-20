import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(projectRoot, 'db', 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL || '';
const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();

function isLocalDatabaseUrl(url) {
  return /localhost|127\.0\.0\.1|::1|host\.docker\.internal/i.test(url);
}

const isProductionLike =
  appEnv === 'production' ||
  appEnv === 'prod' ||
  appEnv === 'live' ||
  (!isLocalDatabaseUrl(databaseUrl) && !databaseUrl.includes('smart_landlord_test'));

const allowRemoteMigrations =
  process.env.ALLOW_REMOTE_MIGRATIONS === 'I_HAVE_BACKED_UP_DATABASE';

if (isProductionLike && !allowRemoteMigrations) {
  console.error('');
  console.error('REFUSING TO RUN MIGRATIONS AGAINST A PRODUCTION-LIKE DATABASE.');
  console.error('Take a database backup first, then rerun with ALLOW_REMOTE_MIGRATIONS=I_HAVE_BACKED_UP_DATABASE.');
  console.error('');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function ensureMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations() {
  const result = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(result.rows.map(row => row.filename));
}

async function runMigration(filename) {
  const fullPath = path.join(migrationsDir, filename);
  const sql = await fs.readFile(fullPath, 'utf8');

  console.log(`Applying ${filename}...`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  await client.connect();
  try {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();
    const files = (await fs.readdir(migrationsDir))
      .filter(file => file.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file}; already applied.`);
        continue;
      }
      await runMigration(file);
      appliedCount += 1;
    }

    console.log(`Migration complete. Applied ${appliedCount} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('Migration failed.');
  console.error(error);
  process.exit(1);
});

