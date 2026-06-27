import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
const backupDir = process.env.DB_BACKUP_DIR || path.resolve(process.cwd(), 'backups');
const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();

if (!databaseUrl) {
  console.error('DATABASE_URL is required to create a database backup.');
  process.exit(1);
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', 'Z');
}

function inferEnvironmentLabel() {
  if (appEnv === 'production' || appEnv === 'prod' || appEnv === 'live') return 'production';
  if (appEnv === 'staging') return 'staging';
  if (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')) return 'local';
  return appEnv || 'database';
}

async function main() {
  await fs.mkdir(backupDir, { recursive: true });

  const envLabel = inferEnvironmentLabel();
  const fileName = `smart-landlord-${envLabel}-${timestamp()}.dump`;
  const outputPath = path.join(backupDir, fileName);

  console.log('');
  console.log('Creating PostgreSQL backup...');
  console.log(`Environment: ${envLabel}`);
  console.log(`Output file: ${outputPath}`);
  console.log('');

  const args = [
    '--format=custom',
    '--verbose',
    '--no-owner',
    '--no-acl',
    '--file',
    outputPath,
    databaseUrl
  ];

  const child = spawn('pg_dump', args, {
    stdio: 'inherit',
    shell: false
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  if (exitCode !== 0) {
    console.error('');
    console.error(`Database backup failed with exit code ${exitCode}.`);
    process.exit(exitCode || 1);
  }

  const stat = await fs.stat(outputPath);

  console.log('');
  console.log('Database backup complete.');
  console.log(`Backup file: ${outputPath}`);
  console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('');
}

main().catch((error) => {
  console.error('Database backup failed.');
  console.error(error);
  process.exit(1);
});
