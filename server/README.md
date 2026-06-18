# Server Data Layer Notes

The app currently has two data layer paths:

| File | Purpose |
|---|---|
| `db.js` | Current synchronous JSON-backed demo adapter used by `server.js`. |
| `postgresDb.js` | Async PostgreSQL adapter for production route migration. |
| `routes/propertyRoutes.js` | PostgreSQL-backed properties, units, and tenants route family. |
| `routes/financialRoutes.js` | PostgreSQL-backed invoices, payments, allocations, and reversals route family. |
| `routes/reconciliationRoutes.js` | PostgreSQL-backed CSV staging, matching, ignoring, and transaction-safe reconciliation route family. |
| `routes/webhookRoutes.js` | PostgreSQL-backed M-Pesa/bank payment webhook route with idempotent transaction-safe posting. |

`server.js` still uses `db.js` so the demo app remains functional while routes are migrated safely.

Set `DATA_BACKEND=postgres` to activate migrated PostgreSQL route families. If unset, the app uses the legacy JSON-backed route handlers.

Current PostgreSQL-backed route families:

- `GET/POST/PUT/DELETE /api/properties`
- `GET/POST/PUT/DELETE /api/units`
- `GET/POST/PUT /api/tenants`
- `POST /api/tenants/:id/vacate`
- `GET/POST/PUT /api/invoices`
- `GET /api/invoices/:id`
- `POST /api/invoices/:id/issue`
- `POST /api/invoices/:id/void`
- `POST /api/invoices/:id/send-reminder`
- `GET/POST /api/payments`
- `POST /api/payments/:id/reverse`
- `GET /api/reconciliation/staging`
- `GET /api/reconciliation/sample-csv`
- `POST /api/reconciliation/upload`
- `POST /api/reconciliation/import-finalize`
- `POST /api/reconciliation/match`
- `POST /api/reconciliation/ignore`
- `POST /api/webhooks/payment`

The PostgreSQL payment create and payment reversal flows use explicit database transactions so ledger rows, allocations, notification logs, audit logs, and invoice balance updates commit or roll back together.

The PostgreSQL reconciliation match flow also uses an explicit database transaction so the staging row, ledger transaction, invoice allocations, invoice balances, notification log, and audit log commit or roll back together.

The PostgreSQL webhook payment flow is public by design, but idempotent by provider reference number with a transaction-level advisory lock. Matched callbacks post directly to the ledger as M-Pesa or bank payments and allocate invoices inside one transaction. Unmatched callbacks are staged for reconciliation and create a landlord notification in the same transaction.

Auth/session lookup still uses the current JSON-backed auth flow until the auth route family is migrated.

## Production Migration Path

Move route families one at a time from `db.js` to `postgresDb.js`:

1. Auth/session users, organizations, and memberships.
2. Properties, units, and tenants.
3. Invoices, invoice items, payments, and allocations.
4. Reconciliation batches and staging rows.
5. Integrations, notifications, SaaS billing, and audit logs.

Each migrated route should become `async`, use `await pgDb.*`, and keep the existing business rules covered by smoke/API tests.

Do not create a synchronous PostgreSQL wrapper around child processes or shell commands. Financial workflows need real database transactions and predictable error handling.
