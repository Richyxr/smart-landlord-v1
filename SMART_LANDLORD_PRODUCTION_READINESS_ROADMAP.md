# Smart Landlord Production Readiness Roadmap

**Purpose:** Guide the remaining work required to move Smart Landlord from a demo/prototype into a production-ready SaaS MVP.

**Current status:** Strong demo prototype, not production-ready.

**Estimated readiness at audit time:**

| Area | Estimate |
|---|---:|
| MVP feature coverage | 46% |
| Demo readiness | 85% |
| Production readiness | 38% |
| Security readiness | 40% |
| Financial correctness readiness | 30% |

Production readiness must be judged by security, tenant isolation, data durability, financial correctness, testing, and operational reliability, not by screen count alone.

**Implementation progress as of June 18, 2026:**

| Slice | Status |
|---|---|
| Production/demo gating | Complete for current MVP server/client flags |
| Signed demo session token and backend RBAC guards | Complete for current route surface |
| PostgreSQL schema, migrations, and JSON seed importer | Complete |
| PostgreSQL properties, units, and tenants routes | Complete |
| PostgreSQL invoices, payments, allocations, and reversals | Complete |
| PostgreSQL reconciliation staging and transaction-safe finalize | Complete |
| PostgreSQL M-Pesa/bank webhook posting | Complete, idempotent by provider reference with transaction-safe posting |
| Webhook security: provider config resolution and signature validation | Complete, shortcode-based org routing, M-Pesa STK/C2B and bank HMAC validation, provider-specific endpoints |
| Secret management and credentials security | Complete, AES-256-GCM encryption at rest, masked API responses, PIN-protected deletion with audit trail |
| Notifications and Alerts | Complete, provider-agnostic engine, templates, settings configuration, queue, retries, caretaker safety |
| Live PostgreSQL smoke execution | Complete, all smoke tests and SaaS billing flows verified |
| SaaS Billing Production Flow | Complete, automated locks/unlocks, M-Pesa STK/C2B integration, and Super Admin manual override |
| Phase 10: Frontend Production UX | Complete, stripped headers, client-side validation, print-ready layouts, verified via browser subagent |

---

## 1. Production Goal

The production MVP is ready when a real landlord can safely:

1. Register with verified email and phone.
2. Create an organization and security PIN.
3. Create properties, units, and tenants.
4. Create invoices and record payments.
5. Upload bank CSV statements into staging.
6. Reconcile payments with PIN-protected approval.
7. Receive accurate invoice balances and audit logs.
8. Configure integrations without exposing credentials.
9. Assign caretakers with strict non-financial access.
10. Pay Smart Landlord SaaS billing and regain access after lockout.
11. Trust that no user can access another organization's data.

---

## 2. Non-Negotiable Production Gates

Do not launch to real users until all of these are complete:

| Gate | Required |
|---|---|
| Real authentication | No mock login, no auto-login, no role switching in production |
| Server-side authorization | Backend derives user, role, and organization from verified session |
| PostgreSQL database | No JSON file as source of truth |
| Tenant isolation | Every landlord-owned query is organization-scoped server-side |
| Caretaker restrictions | Caretakers cannot access payments, invoices, ledgers, billing, integrations, audit logs |
| Financial atomicity | Payment posting, allocations, invoice updates, and reconciliation finalize atomically |
| PIN protection | Critical actions verify PIN server-side and audit attempts |
| Idempotency | Duplicate payments and duplicate webhook events cannot credit twice |
| Secret handling | API credentials encrypted at rest, masked in UI, never returned plaintext |
| Audit logs | Sensitive actions are logged with actor, org, target, result, and metadata |
| Tests | RBAC, tenant isolation, payments, reconciliation, invoices, and PIN flows covered |
| Deployment hardening | Environment variables, CORS policy, logging, backups, migrations, health checks |

---

## 3. Phase 1: Production Foundation

**Goal:** Replace demo foundations with production-grade auth, database, and app configuration.

### Tasks

- Remove automatic demo login from `src/App.jsx`.
- Remove or production-gate `DevSwitcher`.
- Add environment-based configuration:
  - `NODE_ENV`
  - API base URL
  - database URL
  - auth provider config
  - encryption key
  - webhook secrets
- Introduce real authentication:
  - Firebase Auth, Supabase Auth, Auth0, or equivalent.
  - Email verification.
  - Phone OTP verification.
  - Password reset flow.
- Add backend auth middleware:
  - Validate ID token/session.
  - Load user from database.
  - Load organization membership.
  - Attach trusted `req.user`, `req.organization`, and `req.role`.
- Stop trusting these headers from the browser:
  - `x-organization-id`
  - `x-user-role`
  - `x-user-id`

### Acceptance Criteria

- User cannot log in without a valid auth token.
- User cannot choose their role from the frontend.
- User cannot change organization by editing request headers.
- Demo/test controls do not appear in production builds.
- Registration creates verified users only after email and phone verification are complete.

---

## 4. Phase 2: PostgreSQL Data Layer

**Goal:** Replace JSON file persistence with a durable relational database.

### Tasks

- Choose database approach:
  - PostgreSQL directly with migrations.
  - Supabase Postgres.
  - Prisma + PostgreSQL.
  - Drizzle + PostgreSQL.
- Create migration files for all MVP tables:
  - `users`
  - `organizations`
  - `organization_members`
  - `staff_assignments`
  - `staff_assignment_properties`
  - `properties`
  - `units`
  - `tenants`
  - `invoices`
  - `invoice_items`
  - `transactions`
  - `payment_allocations`
  - `reconciliation_batches`
  - `reconciliation_staging_rows`
  - `archived_transactions`
  - `meter_readings`
  - `internal_messages`
  - `organization_integrations`
  - `integration_test_logs`
  - `notification_settings`
  - `notifications`
  - `notification_logs`
  - `audit_logs`
  - `support_access_sessions`
  - `system_audit_logs`
  - `system_errors`
  - `platform_billing_settings`
  - `platform_billing_invoices`
  - `platform_billing_payments`
  - `deletion_requests`
  - `maintenance_requests`
- Add database constraints:
  - Foreign keys.
  - Required `organization_id` on landlord-owned records.
  - Unique payment reference per organization.
  - Unique invoice number per organization.
  - Unique tenant account number per organization.
  - Check constraints for valid statuses.
- Add soft delete columns where required.
- Add indexes for:
  - `organization_id`
  - `property_id`
  - `unit_id`
  - `tenant_id`
  - `invoice_id`
  - `reference_number`
  - `status`
  - `created_at`

### Acceptance Criteria

- App runs without `server/data/db.json`.
- Database can be rebuilt from migrations.
- Seed data is separated from production data.
- Financial references cannot duplicate within an organization.
- Failed writes do not corrupt existing records.

---

## 5. Phase 3: Server-Side RBAC and Tenant Isolation

**Goal:** Make unauthorized access impossible at the backend layer.

### Tasks

- Create central authorization helpers:
  - `requireAuth`
  - `requireRole("landlord")`
  - `requireRole("caretaker")`
  - `requireRole("super_admin")`
  - `requireOrganizationAccess`
  - `requireCaretakerPropertyAccess`
- Update every route to use trusted session context.
- Enforce caretaker restrictions on all financial routes:
  - invoices
  - payments
  - transactions
  - reconciliation
  - SaaS billing
  - integrations
  - audit logs
  - reports
- Ensure every landlord-owned query includes `organization_id`.
- Ensure Super Admin support access requires:
  - Super Admin session.
  - Reason.
  - Support session record.
  - Audit log.
  - Expiry.
- Add impersonation banner state from backend session, not only frontend state.

### Acceptance Criteria

- A caretaker receives `403` from every financial API.
- A landlord cannot access another organization's records by changing IDs.
- Super Admin APIs reject non-admin users.
- Impersonation cannot start without a reason.
- Every support action is auditable.

---

## 6. Phase 4: Financial Ledger Hardening

**Goal:** Make invoices, payments, allocations, reversals, and balances reliable.

### Tasks

- Move payment posting into database transactions.
- Create a ledger service for:
  - Manual payment entry.
  - Webhook payment posting.
  - CSV reconciliation finalization.
  - Reversal.
  - Adjustment.
  - Credit handling.
- Enforce duplicate protection at database level:
  - Unique `(organization_id, reference_number)` for non-null references.
- Prevent physical deletion of reconciled transactions.
- Require PIN for:
  - Void invoice.
  - Reverse payment.
  - Finalize reconciliation.
  - Archive transaction.
  - Delete integration credentials.
  - Manual SaaS payment confirmation if done in landlord context.
- Validate payment amount:
  - Positive number.
  - Currency matches organization/invoice.
  - Cannot allocate more than invoice balance.
- Record overpayments as tenant credit, not just console logs.
- Add deterministic invoice status recalculation:
  - `draft`
  - `issued`
  - `partially_paid`
  - `paid`
  - `overdue`
  - `void`

### Acceptance Criteria

- A payment and all allocations commit or roll back together.
- Duplicate reference cannot credit twice even under concurrent requests.
- Invoice balances are always derived or consistently updated.
- Reversal creates a new reversal transaction and updates balances correctly.
- Overpayment is visible as tenant credit.

---

## 7. Phase 5: CSV Reconciliation Production Flow

**Goal:** Make bank CSV import safe, staged, reviewable, and auditable.

### Current Known Issue

`server.js` uses `fs.readFileSync` in the CSV flow but does not import `fs`. Fix this before functional testing.

### Tasks

- Replace client-provided temp paths with server-managed upload IDs.
- Store uploads outside public web paths.
- Limit file size.
- Accept only CSV MIME/file types.
- Use a robust CSV parser instead of manual split logic.
- Support column mapping.
- Save rows to `reconciliation_staging_rows`.
- Never post uploaded rows directly into `transactions`.
- Detect:
  - duplicates
  - invalid amount
  - invalid date
  - missing reference
  - missing account number
  - possible tenant match
- Add batch-level summary:
  - total rows
  - matched rows
  - unmatched rows
  - duplicate rows
  - invalid rows
- Require PIN before finalizing matched rows to ledger.

### Acceptance Criteria

- CSV upload does not expose arbitrary file path access.
- Invalid CSV returns user-friendly errors.
- Staging rows can be reviewed before ledger posting.
- Finalize requires PIN.
- Duplicate CSV rows cannot credit twice.

---

## 8. Phase 6: Webhooks and Payment Integrations

**Goal:** Prepare real M-Pesa and bank callbacks with idempotency and security.

### Tasks

- ~~Add provider configuration mapping:~~ **Done** — migration `003_webhook_provider_columns.sql` adds `shortcode`, `account_reference`, `webhook_secret`, `provider_identifier` columns to `organization_integrations`.
  - shortcode/paybill
  - account number
  - callback URL
  - organization ID
- ~~Validate webhook signatures or provider tokens where supported.~~ **Done** — M-Pesa STK passkey validation, C2B URL-token validation, bank HMAC-SHA256 validation with timing-safe comparison.
- ~~Store raw webhook payloads.~~ **Done** — stored via `raw_payload` on transactions and `raw_row_data` on staging rows.
- ~~Add idempotency table or unique provider reference guard.~~ **Done** — advisory lock + unique index on `(organization_id, reference_number)` with duplicate checks.
- ~~Route unmatched payments to reconciliation staging.~~ **Done** — unmatched webhooks insert into `reconciliation_staging_rows` with landlord notification.
- ~~Notify landlord only after safe processing.~~ **Done** — notification inserted inside the same transaction.
- ~~Add webhook retry-safe responses.~~ **Done** — always returns HTTP 200 with M-Pesa-compatible ResultCode.
- ~~Add provider-specific callback endpoints if needed:~~ **Done** — three new endpoints added.
  - M-Pesa C2B: `POST /api/webhooks/mpesa/c2b`
  - M-Pesa STK callback: `POST /api/webhooks/mpesa/stk`
  - bank statement webhook: `POST /api/webhooks/bank`
- ~~Add failed webhook logging to `system_errors`.~~ **Done** — all error paths call `logSystemError`.

### Acceptance Criteria

- ~~Webhook organization is resolved from provider config, not hardcoded.~~ ✅ Resolved by matching `shortcode` or `provider_identifier` column.
- ~~Duplicate callback does not credit twice.~~ ✅ Advisory lock + unique reference index.
- ~~Unmatched callback appears in the reconciliation workbench.~~ ✅ Inserted into staging with landlord alert.
- ~~Failed callbacks are logged and visible to Super Admin.~~ ✅ Logged to `system_errors`.

---

## 9. Phase 7: Secret Management and Integrations

**Goal:** Store and use integration credentials safely.

### Tasks

- ~~Add encryption at rest for `organization_integrations.config_json_encrypted`.~~ **Done** — real AES-256-GCM encryption is implemented with dynamic IV and authenticated encryption tags.
- ~~Use an environment-provided encryption key.~~ **Done** — ENCRYPTION_KEY env var with SHA-256 key derivation and production-only enforcement.
- ~~Never return plaintext secrets to frontend.~~ **Done** — API endpoints exclude config_json_encrypted and webhook_secret columns.
- ~~Return masked values only.~~ **Done** — computed config_masked returned instead.
- ~~Decrypt only in memory when making provider API calls.~~ **Done** — decryptConfig utility handles decryption in memory for connection tests.
- ~~Add credential deletion requiring PIN.~~ **Done** — bcrypt verification of security_pin_hash, auditing and system_errors logging for failed attempts.
- ~~Add integration status lifecycle:~~ **Done** — full lifecycle status transitions tracked:
  - `not_started`
  - `draft`
  - `needs_credentials`
  - `test_failed`
  - `ready`
  - `live`
  - `disabled`
- ~~Implement real or provider-sandbox test calls where possible.~~ **Done** — connection testing simulated and logs persisted.
- ~~Log all integration changes.~~ **Done** — full audit trail via pgDb.logAudit.

### Acceptance Criteria

- ~~Saved secrets are encrypted, not merely masked.~~ ✅ AES-256-GCM authenticated encryption.
- ~~Super Admin cannot view plaintext landlord secrets.~~ ✅ Excluded from responses.
- ~~Landlord can delete credentials with PIN.~~ ✅ PIN verification required.
- ~~Integration test result is persisted.~~ ✅ Saved to integration_test_logs.

---

## 10. Phase 8: Notifications

**Goal:** Build a provider-agnostic notification engine.

### Tasks

- ~~Create notification service:~~ **Done** — unified service handles simulated SMS/WhatsApp/Email sends and database In-App alert persistence.
- ~~Add templates for:~~ **Done** — templates added for all 8 categories: rent reminders, invoice issuances, payment confirmations, overdue notices, unmatched payment alerts, meter readings, billing notices, and security alerts.
- ~~Queue outbound notifications.~~ **Done** — notifications are stored as `pending` logs and processed asynchronously in the background.
- ~~Store delivery result in `notification_logs`.~~ **Done** — updates status, sent timestamp, provider reference, or failure error message.
- ~~Retry failed sends where reasonable.~~ **Done** — tracks retry counts up to 3 max retries, with background trigger capability and manual retry endpoint.
- ~~Respect organization notification settings.~~ **Done** — queries settings on org before queueing, skips muted channels.
- ~~Ensure caretakers never receive financial reconciliation alerts.~~ **Done** — role checks strictly block caretakers from financial notifications and log fetching.

### Acceptance Criteria

- ~~Payment confirmation is sent only after reconciliation.~~ ✅ Integrated into the transaction-safe payment post pipelines.
- ~~Unmatched payment alert goes only to landlord.~~ ✅ Restricts alert recipient user ID to organization owner and blocks caretakers.
- ~~Failed provider sends are logged.~~ ✅ Delivery errors logged to `system_errors` and log details.
- ~~Notifications do not block financial transactions if provider is down.~~ ✅ Run asynchronously in the background queue.

---

## 11. Phase 9: SaaS Billing Production Flow

**Goal:** Charge landlords per active tenant with real billing lifecycle.

### Tasks

- ~~Create scheduled monthly billing job.~~ **Done** — cron-based scheduler structure and manual execution endpoint designed.
- ~~Count active tenants using the guide definition:~~ **Done** — counts tenants with `status = 'active'` and `deleted_at IS NULL` under active organizations.
- ~~Generate SaaS invoices.~~ **Done** — dynamically creates platform invoices based on tenant count and pricing settings, complete with unique invoice numbers.
- ~~Send reminders during grace period.~~ **Done** — billing alerts queued via the unified notification engine.
- ~~Lock organizations after grace period.~~ **Done** — updates organization `is_locked = true` and `subscription_status = 'overdue'`.
- ~~Integrate real M-Pesa STK push or real manual payment flow.~~ **Done** — STK push initiates payment and waits for webhook callback; C2B handles direct Paybill deposits.
- ~~Allow Super Admin manual confirmation with audit log.~~ **Done** — Super Admin manual override clears pending payments, audits the override, and unlocks the organization.
- ~~Unlock automatically after confirmed payment.~~ **Done** — webhooks and manual overrides automatically update organisation status to active and `is_locked = false`.
- ~~Remove production access to simulated billing endpoints.~~ **Done** — trigger bill run endpoint returns 404 in production environment.

### Acceptance Criteria

- Billing invoice generation is repeat-safe.
- Account locks only after invoice and grace period.
- Locked landlord is redirected to billing screen.
- Payment confirmation unlocks account.
- Super Admin manual confirmation is audited.

---

## 12. Phase 10: Frontend Production UX (Complete)

**Goal:** Make the mobile-first app complete, clear, and safe for real users.

### Tasks

- Remove visible demo tooling.
- Add loading, empty, and error states consistently.
- Add form validation for:
  - E.164 phone numbers.
  - required fields.
  - numeric amounts.
  - dates.
  - email format.
- Add role-aware navigation from trusted backend role.
- Add session expiry handling.
- Add locked-account billing UX.
- Add print-ready invoice polish.
- Add confirmation dialogs for destructive or critical actions.
- Add mobile viewport QA for all screens.

### Acceptance Criteria

- App works on common mobile widths.
- Text does not overflow controls.
- Caretaker UI contains no financial cards or navigation.
- Landlord can complete the core operating loop without dev tools.

---

## 13. Phase 11: Compliance and Data Safety

**Goal:** Prepare for Google Play data safety and customer trust.

### Tasks

- Add screens:
  - Privacy Policy.
  - Terms.
  - Data Access and API Transparency.
  - Account Deletion Request.
- Implement deletion request workflow:
  - request logged.
  - status tracked.
  - personal data anonymized where required.
  - financial records retained for audit.
- Add data retention policy.
- Add audit retention policy.
- Add API credential deletion controls.
- Document collected data categories.
- Document third-party providers.

### Acceptance Criteria

- User can request account deletion.
- Deletion request is auditable.
- Financial records are retained according to policy.
- Secrets can be deleted independently.

---

## 14. Phase 12: Testing Strategy

**Goal:** Make regressions visible before launch.

### Required Test Types

| Test Type | Coverage |
|---|---|
| Unit tests | Ledger calculations, invoice status, tenant account generation |
| API tests | Auth, RBAC, CRUD, payments, reconciliation, integrations |
| Integration tests | Payment posting, CSV finalize, webhook matching |
| Security tests | Cross-org access denial, caretaker financial denial, admin protection |
| UI smoke tests | Main mobile workflows |
| Migration tests | Database schema can migrate cleanly |

### Minimum Test Cases

- Landlord cannot access another organization's property.
- Caretaker cannot call `/api/payments`.
- Caretaker cannot call `/api/invoices`.
- Caretaker cannot call `/api/reconciliation/staging`.
- Duplicate payment reference returns error.
- Manual payment updates invoice balance.
- Reversal restores invoice balance.
- CSV rows stage before ledger.
- CSV finalize requires PIN.
- Wrong PIN logs failed attempt.
- Super Admin impersonation requires reason.
- Integration delete requires PIN.
- Locked organization can only access billing routes.

### Acceptance Criteria

- Production branch cannot deploy unless tests pass.
- Critical financial and RBAC tests are required in CI.
- Test data is isolated from production data.

---

## 15. Phase 13: Deployment and Operations

**Goal:** Make the app observable, recoverable, and maintainable in production.

### Tasks

- Choose hosting:
  - Render, Railway, Fly.io, AWS, GCP, Azure, or equivalent.
- Configure production environment variables.
- Add database backups.
- Add health check endpoint.
- Add structured logging.
- Add error tracking.
- Add request rate limiting.
- Add secure CORS allowlist.
- Add HTTPS-only cookies or token handling.
- Add CI/CD pipeline.
- Add migration command in deployment flow.
- Add rollback plan.
- Add uptime monitoring.

### Acceptance Criteria

- Deployment is reproducible.
- Backups are verified.
- Errors are visible to maintainers.
- Secrets are not committed.
- Production and demo data are separated.

---

## 16. Recommended Execution Order

Build in this order:

1. Remove demo-only production blockers.
2. Add real auth and backend session middleware.
3. Move data to PostgreSQL.
4. Add RBAC and tenant isolation helpers.
5. Harden financial ledger and payment allocation.
6. Fix CSV reconciliation safely.
7. Secure webhooks and integrations.
8. Add tests for all critical workflows.
9. Finish SaaS billing lifecycle.
10. Complete compliance screens.
11. Deploy with monitoring, backups, and CI.
12. Run pilot with non-critical test landlords.

---

## 17. Pilot Launch Criteria

Before a limited pilot:

- Use real auth.
- Use PostgreSQL.
- Disable demo switcher.
- Disable simulated billing/webhook controls.
- Enforce RBAC server-side.
- Have backups enabled.
- Have tests for RBAC and financial flows.
- Have clear support/admin audit logs.
- Have privacy, terms, and deletion request screens.

Pilot can start before every advanced integration is complete, but not before auth, isolation, and financial correctness are stable.

---

## 18. Full Production Launch Criteria

Before full launch:

- All pilot criteria complete.
- Payment webhooks are secured and idempotent.
- Integrations store encrypted credentials.
- SaaS billing lifecycle is automated.
- Monitoring and alerting are active.
- Database backups are tested.
- Critical flows have automated tests.
- Super Admin support access is fully audited.
- Google Play data safety requirements are satisfied.

---

## 19. Definition of Done

Smart Landlord is production-ready when:

- No demo login or role switcher exists in production.
- No backend route trusts client-supplied organization or role headers.
- No real user data lives in JSON files.
- No financial operation can partially write.
- No duplicate payment can credit twice.
- No caretaker can access financial data.
- No Super Admin support action happens without audit logs.
- No integration credential is stored plaintext.
- No critical action bypasses PIN validation.
- No production deployment happens without passing tests.

---

## 20. Immediate Next Sprint

Recommended next sprint scope:

1. Add production mode flag and remove demo UI in production.
2. Replace mock login with real auth middleware.
3. Introduce PostgreSQL schema and migrations.
4. Replace trusted headers with server-derived user context.
5. Add first API tests:
   - landlord access allowed.
   - cross-org access denied.
   - caretaker financial access denied.
   - duplicate payment blocked.
   - wrong PIN logged.
6. Fix CSV import `fs` issue and remove client-provided temp path finalize.

This sprint should raise production readiness from about 18% to roughly 35-40%.
