# Smart Landlord Database

This directory contains the production PostgreSQL migration target for Smart Landlord.

The current app still runs on `server/data/db.json` for demo/development continuity. Production work should migrate runtime reads/writes to PostgreSQL using the schema in `migrations/001_initial_schema.sql`.

## Migration Direction

1. Provision PostgreSQL.
2. Set `DATABASE_URL`.
3. Run migrations:

   ```bash
   npm run db:migrate
   ```

4. Optionally import the current demo JSON data:

   ```bash
   npm run db:seed:reset-from-json
   ```

5. Add a PostgreSQL data adapter beside the current JSON adapter.
6. Move one module at a time to PostgreSQL:
   - auth/session users
   - organizations/memberships
   - properties/units/tenants
   - invoices/payments/allocations
   - reconciliation
   - integrations/billing/audit logs
7. Remove JSON persistence after all production modules are migrated.

## Commands

| Command | Purpose |
|---|---|
| `npm run db:migrate` | Applies unapplied SQL migrations to `DATABASE_URL`. |
| `npm run db:seed:from-json` | Inserts current `server/data/db.json` data into PostgreSQL. |
| `npm run db:seed:reset-from-json` | Truncates known app tables, then imports current JSON data. |

Set `DATABASE_SSL=true` for managed databases that require SSL.

## Production Requirements

- Every landlord-owned table has `organization_id`.
- Financial references are unique per organization.
- Reconciled transaction rows must not be physically deleted.
- Payment posting and invoice allocation must run inside database transactions.
- Caretaker access must be filtered by assigned properties.
- Super Admin access must be audited.
