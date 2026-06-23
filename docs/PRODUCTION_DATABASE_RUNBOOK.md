# Smart Landlord Production Database Runbook

This runbook defines the minimum operational rules for protecting Smart Landlord PostgreSQL data.

## Golden rules

1. Normal deploys must not run seed or reset commands.
2. Production database resets are prohibited during normal operation.
3. Production migrations require a fresh backup first.
4. Backups must be restorable, not just created.
5. Financial records, invoices, payments, allocations, reconciliation rows, and audit logs must be preserved.

## Normal deploy

Use this for ordinary frontend/backend deployment:

    npm run build
    firebase deploy

Do not run these during normal deploy:

    npm run db:seed:from-json
    npm run db:seed:reset-from-json
    npm run db:migrate

## Safety guards

The seed reset command is guarded and should refuse production-like destructive resets.

The migration command is guarded and should refuse production-like migrations unless a backup confirmation variable is set.

## Backup command

Set DATABASE_URL to the database you intend to back up, then run:

    npm run db:backup

Backups are written to:

    backups/

Backup files are ignored by Git.

## Production migration process

Before a production migration:

    npm run db:backup

Confirm the backup file exists in backups/.

Then run the migration only after backup confirmation:

    $env:ALLOW_REMOTE_MIGRATIONS="I_HAVE_BACKED_UP_DATABASE"
    npm run db:migrate
    Remove-Item Env:\ALLOW_REMOTE_MIGRATIONS

## Restore test requirement

A backup is not trusted until it has been restored into a separate test database.

Minimum restore validation:

1. Restore backup into a non-production database.
2. Start the app against the restored database.
3. Confirm organizations, properties, units, tenants, invoices, payments, payment allocations, reconciliation rows, and audit logs are present.
4. Confirm login and dashboard access work.
5. Confirm invoice balances and payment allocations are consistent.

## Production readiness checklist

Before treating the database as production-ready:

- [ ] Normal deploy does not delete records.
- [ ] Seed reset guard refuses production-like reset.
- [ ] Migration guard refuses production-like migration without backup confirmation.
- [ ] npm run db:backup creates a backup file.
- [ ] A backup has been restored into a separate test database.
- [ ] Tenant/property/invoice/payment workflows pass after restore.
- [ ] Reconciliation duplicate checks work.
- [ ] Webhook duplicate checks work.
- [ ] Audit logs are created for sensitive actions.
- [ ] Production secrets are not committed to Git.
- [ ] ENCRYPTION_KEY environment secret is configured in App Hosting to enable AES-256-GCM encryption of saved API credentials.
