# Smart Landlord SaaS MVP — Agent Build Guide

**Document purpose:** This file is the single source of truth for an implementation agent building the Smart Landlord mobile SaaS MVP from scratch to finish.

**Product name:** Smart Landlord  
**Product type:** Mobile-first multi-tenant SaaS for landlords  
**Primary market:** Kenya / East Africa first, with future multi-country support  
**Primary users:** Super Admin, Landlord, Caretaker  
**Core promise:** Help landlords manage properties, units, tenants, rent invoices, payments, bank/M-Pesa reconciliation, caretaker operations, SaaS billing, integrations, notifications, and audit/compliance from one secure mobile app.

---

## 0. Read This Before Building

Build this product step by step. Do not rush into advanced modules before the core operating loop works.

The MVP must be **simple but deep**. Every feature that is included must work end-to-end, with correct permissions, tenant isolation, audit logging, and mobile UI behavior.

The app must not become a shallow property-management demo. It must behave like a real SaaS system that a landlord can use to run their rental business.

### Core MVP Operating Loop

The first complete product loop is:

```text
Landlord registers -> verifies email and phone -> creates organization profile -> creates security PIN -> creates property -> creates units -> adds tenants -> creates invoices -> records/imports payments -> reconciles payments -> invoice balances update -> notifications/audit logs are created -> reports/dashboard update.
```

### Do Not Overcomplicate

Do not build these early:

- Full accounting suite
- Complex expense management
- Tenant marketplace
- Vendor marketplace
- E-signatures
- Legal contract generation
- Loan products
- Advanced AI assistant
- Full property-management-company hierarchy
- Complex tax engine
- Full PDF engine before print-ready invoices
- Complex procurement
- Advanced analytics before core workflows work

Maintenance/work orders can be included only as a light practical module after core property, invoice, payment, reconciliation, and caretaker flows are stable.

---

## 1. Product Summary

Smart Landlord is a mobile-first SaaS platform for landlords. It allows a landlord to:

- Register as an individual or company.
- Verify both email and phone number.
- Create and manage a landlord organization profile.
- Create properties and units.
- Add tenants and assign them to units.
- Generate invoices and track balances.
- Record payments manually.
- Import bank CSV statements for reconciliation.
- Prepare for M-Pesa and bank payment webhooks.
- Automatically or manually match payments to tenants/invoices.
- Keep unmatched payments in a workbench until resolved.
- Assign caretakers to one or more properties.
- Let caretakers submit meter readings and operational updates.
- Communicate in-app and off-app between landlord and caretaker.
- Configure SMS, M-Pesa, bank, WhatsApp, and future integrations from the dashboard.
- Protect critical actions with a 6-digit security PIN.
- Keep audit logs visible to landlords under Settings.
- Charge landlords as SaaS customers using a per-active-tenant billing model.
- Allow Super Admin to manage, support, bill, and impersonate landlord dashboards with full audit logging.

---

## 2. System Roles

The system has exactly three primary MVP roles:

1. **Super Admin**
2. **Landlord**
3. **Caretaker**

Do not build a full tenant/client portal in the initial MVP unless explicitly approved later. Tenants are records managed by the landlord. Tenants may receive SMS/WhatsApp/email notifications, appear on invoices, make payments, and submit maintenance requests later, but a full tenant login portal is not part of the core first build unless deliberately added as a later slice.

---

## 3. Multi-Tenant Architecture

### 3.1 Main Hierarchy

Use this hierarchy:

```text
Platform
  └── Landlord Organization
        └── Properties
              └── Units
                    └── Tenants
                          └── Invoices
                          └── Transactions
                          └── Meter Readings
                          └── Maintenance Requests later/light
```

The top-level tenant is the **Landlord Organization**.

The organization can represent:

- Individual landlord
- Company / organization landlord

Do not add a property-management-company layer in MVP. That can be introduced later for agencies that manage multiple landlord accounts.

### 3.2 Organization Isolation

Every landlord-owned table must include:

```text
organization_id
created_at
updated_at
deleted_at where relevant
```

Every backend operation must enforce organization scoping.

No query should access landlord-owned data unless one of these is true:

1. The authenticated user belongs to that `organization_id` and has permission.
2. The backend is running as a trusted `service_role` for Super Admin/platform support and logs the action.

Frontend filtering is not security. The backend/database must enforce isolation.

### 3.3 Recommended Data Isolation Rule

For all normal user operations:

```text
WHERE organization_id = current_user.organization_id
```

For caretaker operations, additionally restrict by assigned properties:

```text
WHERE organization_id = current_user.organization_id
AND property_id IN caretaker_assigned_property_ids
```

For Super Admin service access:

- Require `service_role` or explicit Super Admin claim.
- Require reason for sensitive access.
- Create audit log.
- Show impersonation banner if acting in landlord context.

---

## 4. Recommended Technology Architecture

Use a practical modern mobile SaaS architecture.

Recommended stack assumptions:

```text
Frontend: Mobile-first app UI
Auth: Firebase Authentication or equivalent
Backend: Cloud Functions / API routes / server actions
Database: PostgreSQL-style relational database
Security: Row-level security / backend tenant guards
File handling: CSV upload and parser
Notifications: Provider-agnostic SMS/WhatsApp/email/in-app notification layer
Payments: M-Pesa and bank API-ready architecture
Secrets: Encrypted credential storage
```

If the actual implementation uses another stack, preserve the same architecture, entities, authorization rules, and business logic.

---

## 5. Authentication and Registration

### 5.1 Registration Types

The registration screen must ask:

```text
Are you registering as:
1. Individual
2. Company / Organization
```

### 5.2 Required Registration Data

All landlords must provide:

- Name or company name
- Email address
- Phone number
- Country
- Billing currency
- Password

Both email and phone must be verified.

Use E.164 phone number format:

```text
+254712345678
```

### 5.3 Individual Registration

For an individual landlord, collect:

- Full legal name
- Email
- Phone number
- National ID or optional KRA PIN
- Country
- Billing currency

### 5.4 Company Registration

For a company landlord, collect:

- Company name
- Business registration number
- KRA PIN / tax identifier where applicable
- Primary contact person
- Email
- Phone number
- Country
- Billing currency

### 5.5 Post-Registration System Actions

After successful registration:

1. Create `users` record.
2. Create `organizations` record.
3. Create `organization_members` owner record with `role = landlord`.
4. Create default `notification_settings`.
5. Create default setup/readiness state.
6. Create default SaaS billing profile.
7. Prompt landlord to create 6-digit security PIN.
8. Route landlord to dashboard with setup checklist.

### 5.6 Required Auth Screens

- Welcome
- Register
- Register as individual/company
- Verify email
- Verify phone
- Login
- Forgot password
- Organization setup
- Create security PIN

### 5.7 Auth Provider Policy

- Gmail / Googlemail addresses must use Continue with Google.
- The app blocks @gmail.com and @googlemail.com from email/password registration.
- Do not add password setup/linking for Google-authenticated accounts.
- Do not use `createUserWithEmailAndPassword`, `linkWithCredential`, or `updatePassword` to convert a Google/Gmail account into an app-password account.
- Email/password registration remains allowed for non-Gmail addresses.
- Existing invalid email/password login failures should remain generic: “Invalid email or password. Please check your details and try again.”

---

## 6. Role-Based Access Control

### 6.1 Super Admin Role

Super Admin manages the SaaS platform.

Super Admin can:

- View all landlord organizations.
- Manage organization status.
- Manage landlord subscriptions.
- Manage SaaS billing settings.
- View SaaS billing invoices.
- View active tenant counts.
- View system errors.
- View audit logs.
- View support access logs.
- Troubleshoot landlord accounts.
- Start impersonation mode.
- Suspend landlord accounts.
- Reactivate landlord accounts.
- Configure global SaaS paybill/bank details.
- Configure default SaaS pricing.
- Confirm manual SaaS billing payments.

Super Admin access to sensitive landlord data must be treated as support access and must be logged.

### 6.2 Super Admin Impersonation

Super Admin can view the landlord dashboard for troubleshooting.

Before impersonation, require:

- Target landlord organization
- Reason for access
- Confirmation
- Short-lived support session/token

During impersonation, show a persistent high-visibility banner:

```text
Admin Impersonation Active: Viewing [Landlord Name]
```

Log:

- admin_user_id
- target_organization_id
- reason
- started_at
- ended_at
- actions_taken
- impersonation_session_id
- IP/device metadata if available

Super Admin can perform support actions, but sensitive financial support actions must be logged and marked as Super Admin support actions.

### 6.3 Landlord Role

Landlord is the owner/super user of their organization.

Landlord can:

- Manage organization profile.
- Create and edit properties.
- Create and edit units.
- Create and edit tenants.
- Invite caretakers.
- Assign caretakers to one or more properties.
- Create invoices.
- Issue invoices.
- Void invoices.
- Record manual payments.
- Upload bank CSV statements.
- Use reconciliation workbench.
- Manually match unmatched payments.
- Finalize reconciliations.
- View all financial records.
- View audit logs under Settings.
- Create/change security PIN.
- Archive financial records manually.
- Configure SMS/M-Pesa/bank/WhatsApp integrations.
- Review meter readings.
- Send/configure notifications.
- View reports.
- View SaaS billing status.
- Pay SaaS invoices.
- Request account deletion.

Only the landlord can normally reconcile unmatched payments.

### 6.4 Caretaker Role

Caretaker is operational only.

Caretaker can:

- View assigned properties.
- View assigned units.
- Submit meter readings.
- View own submitted meter reading history.
- Communicate with landlord in-app.
- Contact landlord off-app if allowed.
- Update maintenance/work-order status if light maintenance is enabled.

Caretaker cannot:

- View payment history.
- View bank balances.
- View financial ledgers.
- Upload bank CSV files.
- Use reconciliation workbench.
- Match payments.
- Void invoices.
- View revenue reports.
- Access SaaS billing.
- Access integrations.
- View audit logs.
- View sensitive financial settings.
- Approve vendor/maintenance costs.

This must be enforced in both UI and backend.

---

## 7. Caretaker Assignment

The landlord invites a caretaker by phone/email and assigns them to one or more properties.

Use a normalized join table rather than storing property IDs as an array.

### 7.1 staff_assignments

```text
id
organization_id
caretaker_user_id
access_level: caretaker
status: invited | active | disabled
created_by
created_at
updated_at
```

### 7.2 staff_assignment_properties

```text
id
organization_id
staff_assignment_id
property_id
created_at
```

### 7.3 Authorization Logic

Caretaker can only see:

- Their assigned properties.
- Units under assigned properties.
- Meter readings they are allowed to submit/view.
- Messages involving them.
- Maintenance requests for assigned properties if enabled.

Caretaker must not see:

- Any financial table.
- Any reconciliation table.
- Any integration settings.
- Audit logs.
- SaaS billing.

---

## 8. Landlord-Caretaker Communication

Support both in-app and off-app communication.

### 8.1 In-App Messaging

Use `internal_messages`.

```text
id
organization_id
sender_user_id
recipient_user_id
property_id nullable
unit_id nullable
message_body
is_read
created_at
read_at
```

Rules:

- Messages are organization-scoped.
- Landlord can message caretakers.
- Caretaker can message landlord.
- Messages can reference a property or unit.
- Messages should be searchable/auditable.

### 8.2 Off-App Communication

The app may show:

- Call Landlord
- WhatsApp Landlord
- SMS Landlord

Only expose contact details that the landlord allows. Even if the caretaker has the landlord’s contact, the app must never expose financial information to the caretaker.

---

## 9. Core Database Tables

The implementation agent should create or model these entities.

### 9.1 Table List

```text
users
organizations
organization_members
staff_assignments
staff_assignment_properties
properties
units
tenants
invoices
invoice_items
transactions
payment_allocations
reconciliation_batches
reconciliation_staging_rows
archived_transactions
meter_readings
internal_messages
organization_integrations
integration_test_logs
notification_settings
notifications
notification_logs
audit_logs
support_access_sessions
system_audit_logs
system_errors
platform_billing_settings
platform_billing_invoices
platform_billing_payments
deletion_requests
maintenance_requests
```

### 9.2 users

```text
id
auth_provider_uid
email
email_verified
phone_number
phone_verified
name
status
created_at
updated_at
```

### 9.3 organizations

```text
id
owner_user_id
name
type: individual | company
registration_number
tax_identifier
email
phone_number
country
billing_currency
subscription_tier
subscription_status
is_locked
security_pin_hash
status
created_at
updated_at
deleted_at
```

Default billing currency: `KES`. Optional/future: `USD` and other currencies.

### 9.4 organization_members

```text
id
organization_id
user_id
role: landlord | caretaker
status
created_at
updated_at
```

### 9.5 properties

```text
id
organization_id
name
property_type
location
county
town
status: active | inactive
notes
created_at
updated_at
deleted_at
```

Property types:

- Apartment
- Bedsitter block
- Single rental house
- Commercial
- Mixed-use
- Hostel
- Other

### 9.6 units

```text
id
organization_id
property_id
unit_code
unit_type
rent_amount
deposit_amount
status: vacant | occupied | inactive | under_maintenance
floor
block
notes
created_at
updated_at
deleted_at
```

### 9.7 tenants

```text
id
organization_id
property_id
unit_id
tenant_identifier
tenant_account_number
full_name
phone_number
email
id_number nullable
move_in_date
move_out_date nullable
rent_amount
billing_day
status: active | notice | vacated | inactive | deleted
emergency_contact_name
emergency_contact_phone
notes
created_at
updated_at
deleted_at
```

Tenant account number must be system-generated. It is used for payment matching.

`tenant_identifier` should be future-proof so a tenant can move between units later without losing history.

### 9.8 invoices

```text
id
organization_id
property_id
unit_id
tenant_id
invoice_number
invoice_type: rent | utility | deposit | penalty | other
status: draft | issued | partially_paid | paid | overdue | void
issue_date
due_date
currency
subtotal
total
amount_paid
balance
notes
created_by
issued_at
voided_at
voided_by
created_at
updated_at
```

### 9.9 invoice_items

```text
id
organization_id
invoice_id
description
item_type: rent | water | electricity | service_charge | deposit | penalty | other
quantity
unit_price
total
created_at
updated_at
```

### 9.10 transactions

This is the immutable ledger for finalized financial records.

```text
id
organization_id
tenant_id nullable
property_id nullable
unit_id nullable
invoice_id nullable
amount
currency
transaction_type: payment | reversal | adjustment | credit
payment_method: mpesa | bank | cash | other
source: manual | mpesa_callback | bank_callback | bank_csv
reference_number
account_number
payer_name
payer_phone
transaction_date
status: pending | reconciled | unmatched | reversed | duplicate | failed | archived
raw_payload
created_by
reconciled_by
reconciled_at
created_at
updated_at
```

Rules:

- Reconciled transactions cannot be physically deleted.
- Duplicate references cannot credit twice.
- Corrections use reversal/adjustment records.
- Every posting is auditable.
- Critical financial actions require PIN.

### 9.11 payment_allocations

```text
id
organization_id
transaction_id
invoice_id
amount_allocated
allocated_by
allocated_at
created_at
```

### 9.12 reconciliation_batches

Used for bank CSV uploads.

```text
id
organization_id
uploaded_by
source_type: bank_csv
original_file_name
status: uploaded | parsed | reviewed | finalized | failed
total_rows
matched_rows
unmatched_rows
duplicate_rows
invalid_rows
created_at
completed_at
```

### 9.13 reconciliation_staging_rows

This is where bank CSV rows and unmatched webhook payments sit before they become ledger transactions.

```text
id
organization_id
batch_id nullable
raw_row_data
transaction_date
amount
reference_number
account_number
description
payer_name
payer_phone
status: imported | auto_matched | needs_review | unmatched | duplicate | invalid | reconciled | ignored
suggested_tenant_id nullable
suggested_unit_id nullable
suggested_invoice_id nullable
confidence_score nullable
matched_transaction_id nullable
reviewed_by nullable
reviewed_at nullable
error_message nullable
created_at
updated_at
```

### 9.14 archived_transactions

```text
id
original_transaction_id
organization_id
archived_by
archive_reason
archived_at
transaction_snapshot
created_at
```

### 9.15 meter_readings

```text
id
organization_id
property_id
unit_id
tenant_id nullable
meter_type: water | electricity | other
previous_reading
current_reading
usage
reading_date
submitted_by
reviewed_by nullable
status: submitted | reviewed | approved | rejected | billed
notes
created_at
updated_at
```

### 9.16 organization_integrations

```text
id
organization_id
provider_type: sms | mpesa | bank | whatsapp | email
provider_name
environment: sandbox | live
config_json_encrypted
callback_url
is_active
status: not_started | draft | needs_credentials | test_failed | ready | live | disabled
last_tested_at
created_at
updated_at
```

### 9.17 integration_test_logs

```text
id
organization_id
integration_id
tested_by
status: success | failed
response_summary
error_message
created_at
```

### 9.18 notification_settings

```text
id
organization_id
rent_reminders_enabled
reminder_days_before_due
payment_confirmation_enabled
unmatched_payment_alert_enabled
meter_reading_alert_enabled
billing_alerts_enabled
sms_provider
created_at
updated_at
```

### 9.19 notifications

```text
id
organization_id
user_id
type
priority: critical | actionable | informational
title
body
action_url
is_read
created_at
read_at
```

### 9.20 notification_logs

```text
id
organization_id
recipient_user_id nullable
tenant_id nullable
phone_number
channel: sms | whatsapp | email | in_app
type
message
status: pending | sent | failed
provider_reference
error_message
sent_at
created_at
```

### 9.21 audit_logs

```text
id
organization_id nullable
actor_user_id
actor_role
action_type
target_type
target_id
old_values
new_values
metadata
pin_validation_status
reason
created_at
```

### 9.22 support_access_sessions

```text
id
admin_user_id
target_organization_id
reason
started_at
ended_at
status
created_at
updated_at
```

### 9.23 system_audit_logs

```text
id
admin_user_id
target_organization_id
action
reason
impersonation_session_id
metadata
created_at
```

### 9.24 system_errors

```text
id
organization_id nullable
user_id nullable
source
severity: info | warning | error | critical
message
stack_trace nullable
metadata
status: open | investigating | resolved
created_at
resolved_at nullable
```

### 9.25 platform_billing_settings

```text
id
country
currency
price_per_active_tenant
grace_period_days
is_default
created_at
updated_at
```

### 9.26 platform_billing_invoices

```text
id
organization_id
billing_period_start
billing_period_end
billing_currency
active_tenant_count
price_per_active_tenant
subtotal
tax_amount
total
status: draft | issued | paid | overdue | void
issued_at
due_at
paid_at
created_at
updated_at
```

### 9.27 platform_billing_payments

```text
id
organization_id
billing_invoice_id
amount
currency
payment_method: mpesa | bank | manual
reference_number
status: pending | confirmed | failed
confirmed_by nullable
confirmed_at nullable
created_at
```

### 9.28 deletion_requests

```text
id
organization_id
requested_by
request_type: tenant_data | user_account | organization_account | api_credentials
 target_user_id nullable
target_tenant_id nullable
status: requested | in_review | completed | rejected
reason
created_at
completed_at nullable
```

### 9.29 maintenance_requests

Light module only. Do not overbuild.

```text
id
organization_id
property_id
unit_id nullable
tenant_id nullable
reported_by_user_id nullable
title
description
status: open | in_progress | resolved | closed
priority: low | medium | high | urgent
photo_url nullable
assigned_to_user_id nullable
estimated_cost nullable
actual_cost nullable
cost_approved_by nullable
created_at
updated_at
resolved_at nullable
```

---

## 10. Property, Unit, and Tenant Workflows

### 10.1 Property Management

Landlord can create and manage properties.

Property detail should show:

- Units count
- Occupied units
- Vacant units
- Expected rent
- Collected rent
- Arrears
- Assigned caretakers
- Recent activity
- Pending meter readings
- Pending maintenance if enabled

### 10.2 Unit Management

Rules:

- A unit can have one active tenant in MVP.
- A unit can have historical tenants.
- Vacating a tenant does not delete records.
- Unit status updates based on active tenant assignment.

### 10.3 Tenant Management

Tenant detail should show:

- Tenant name
- Phone
- Unit
- Property
- Rent amount
- Billing day
- Current balance
- Last payment
- Next invoice due
- Invoice history
- Payment history
- Meter readings
- Notes

Tenant account numbers are system-generated and used for payment matching.

---

## 11. Invoice Management

### 11.1 Invoice Statuses

```text
draft
issued
partially_paid
paid
overdue
void
```

### 11.2 Invoice Rules

- Draft invoices can be edited.
- Issued invoices cannot be freely edited.
- Paid invoices cannot be deleted.
- Void invoices remain visible for audit.
- Payment allocation updates invoice balance.
- If balance is zero, invoice becomes paid.
- If balance is greater than zero after payment, invoice becomes partially paid.
- If due date passes and balance remains, invoice becomes overdue.

### 11.3 Invoice Screens

- Invoice list
- Invoice detail
- Create invoice
- Edit draft invoice
- Issue invoice
- Void invoice
- Print-ready invoice view

Build a clean print-ready invoice first. Full PDF generation can come later.

---

## 12. Payment and Ledger Logic

### 12.1 Payment Methods

Support:

- M-Pesa
- Bank
- Cash
- Other

### 12.2 Payment Sources

Support:

- Manual entry
- M-Pesa callback
- Bank callback
- Bank CSV upload

### 12.3 Ledger Rules

- Every payment belongs to an organization.
- Unmatched payments may not have tenant_id initially.
- Reconciled transactions are immutable.
- Duplicate references are blocked.
- Corrections use reversals or adjustments.
- Every reconciliation creates an audit log.
- Only landlord can reconcile payments.
- Caretaker cannot see financial ledgers.
- Critical reconciliation actions require PIN.

### 12.4 Overpayment Logic

If a payment is larger than the invoice balance:

1. Pay the invoice fully.
2. Keep extra as tenant credit or unapplied balance.
3. Record it clearly.
4. Do not lose excess amount.

For MVP, show overpayment as tenant credit.

---

## 13. Hybrid Financial Reconciliation Engine

This is one of the most important modules.

The engine supports:

1. Automated M-Pesa/bank webhooks.
2. Manual bank CSV reconciliation.

### 13.1 Automated M-Pesa/Bank Webhook Flow

When a callback arrives:

1. Receive webhook.
2. Extract:
   - amount
   - reference_number
   - account_number
   - payer_name
   - payer_phone
   - transaction_date
   - raw_payload
3. Check duplicate reference.
4. If duplicate, mark duplicate and do not credit.
5. Try matching by:
   - exact invoice number
   - exact tenant account number
   - exact unit code within same organization
   - tenant phone
   - payer phone
   - description/reference fuzzy match
6. If matched confidently:
   - create transaction
   - allocate to invoice or tenant
   - update invoice balance
   - mark reconciled
   - send payment confirmation if enabled
   - write audit log
7. If not matched:
   - create reconciliation staging row
   - mark unmatched
   - notify landlord only
   - do not allocate money

### 13.2 Bank CSV Reconciliation

CSV upload is specifically for bank reconciliation.

Landlord uploads CSV files from banks such as:

- KCB
- Equity
- Absa
- Co-op Bank
- NCBA
- I&M
- Standard Chartered
- Other banks

The system must support flexible column mapping. Do not assume all banks use the same CSV layout.

Supported CSV mapping fields:

- Date
- Amount
- Reference
- Account number
- Description
- Payer name
- Phone number
- Transaction type
- Balance optional

### 13.3 Bank CSV Flow

1. Landlord opens Reconciliation Workbench.
2. Taps Upload Bank Statement.
3. Uploads CSV.
4. System validates file type and basic structure.
5. System previews columns.
6. Landlord maps columns.
7. System imports rows into `reconciliation_staging_rows`.
8. System attempts auto-match.
9. Rows are categorized:
   - auto_matched
   - needs_review
   - unmatched
   - duplicate
   - invalid
10. Landlord reviews rows.
11. Landlord approves auto-matches or manually maps unmatched rows.
12. Finalized rows become immutable transactions.
13. Invoice balances update.
14. Audit logs are written.

### 13.4 Reconciliation Workbench Screen

Landlord-only screen.

Show:

- Upload Bank Statement
- Unmatched payments count
- Auto-matched pending approval
- Duplicate rows
- Invalid rows
- Search by account number
- Search by phone
- Search by reference
- Search by amount
- Search by tenant name
- Search by unit
- Row detail
- Manual match
- Confirm mapping
- Finalize/post
- Ignore row

### 13.5 Manual Match Flow

1. Open unmatched row.
2. Search tenant/unit/invoice.
3. Select correct match.
4. Confirm.
5. Enter 6-digit security PIN.
6. Validate same organization.
7. Validate not duplicate.
8. Validate not already reconciled.
9. Post transaction.
10. Allocate payment.
11. Update invoice.
12. Mark row reconciled.
13. Write audit log.

---

## 14. M-Pesa / Paybill Logic

The paybill account number field is not just for collection. It is for reconciliation.

Tenants may enter:

- Correct invoice number
- Correct tenant account number
- Correct unit code
- Wrong account number
- Missing account number
- Another tenant’s unit code
- Someone else’s phone number

Matching priority:

```text
1. Exact invoice number
2. Exact tenant account number
3. Exact unit code inside same organization
4. Tenant phone number
5. Payer phone number
6. Reference/description fuzzy match
7. Otherwise unmatched
```

Safety rules:

- Never credit twice.
- Never match across organizations.
- Never allow caretaker reconciliation.
- Never delete raw payment payloads.
- Keep unmatched payments visible.
- Allow landlord manual correction.
- Record who reconciled and when.
- Require PIN for final manual reconciliation.

---

## 15. Security PIN for Critical Actions

Landlord must create a 6-digit security PIN.

PIN is required for:

- Reconciling unmatched payment
- Reversing transaction
- Archiving financial records
- Deleting sensitive records
- Changing payment integration settings
- Deleting API credentials
- Voiding issued invoice
- Super Admin support override if applicable

Store only:

```text
security_pin_hash
```

Never store plain PIN.

PIN validation must be logged as success/failure. Do not store the PIN value in logs.

---

## 16. Manual Financial Archiving

Do not auto-archive transactions.

Landlord controls when to archive.

Add:

```text
Settings > Financial Archive
```

Landlord can choose:

- Archive transactions before a selected date
- Archive by date range
- View archive history

Before archiving:

- Show preview count.
- Require confirmation.
- Require 6-digit PIN.
- Write audit log.

Archived transactions move to `archived_transactions`, but audit logs remain visible.

---

## 17. Audit Logs

Audit logs are visible to landlords under:

```text
Settings > Audit Logs
```

Audit logs are hidden from:

- Caretakers
- Tenants/clients

Super Admin can view platform and organization audit logs.

Log these events:

- Login
- Failed login
- Role changes
- Property created/updated/deleted
- Unit created/updated/deleted
- Tenant created/updated/deleted
- Invoice created/issued/voided
- Payment created
- Payment reconciled
- Payment reversed
- CSV uploaded
- CSV row matched
- Bank CSV finalized
- Webhook received
- Duplicate payment detected
- Meter reading submitted
- Integration added/updated/deleted
- API credential deleted
- Financial archive move
- Security PIN created/changed
- Super Admin impersonation started/ended
- Super Admin support action
- SaaS invoice generated
- SaaS payment received
- Account deletion requested
- Maintenance request created/updated/resolved if enabled

---

## 18. Self-Service Integration Portal

The landlord must be able to choose and configure their own providers.

Add:

```text
Settings > Setup & Readiness
Settings > Integrations
```

Provider types:

- SMS
- M-Pesa
- Bank API
- WhatsApp
- Email later

### 18.1 Integration UX

Each provider setup must have:

- Provider name
- Environment: sandbox/live
- Required credential fields
- Callback URL where needed
- Test Connection button
- Save button
- Delete credentials button
- Status badge

### 18.2 Credential Examples

SMS:

- Provider name
- API key
- Username
- Sender ID
- Environment

M-Pesa:

- Consumer key
- Consumer secret
- Shortcode
- Passkey
- Callback URL
- Environment

Bank API:

- Bank name
- Client ID
- Client secret
- API key
- Webhook/callback URL
- Environment

WhatsApp:

- Provider name
- API key
- Phone number ID
- Business account ID
- Webhook token
- Environment

### 18.3 Integration Security Rules

- Never store credentials in plain text.
- Encrypt credentials before saving.
- Mask credentials after saving.
- Only decrypt in memory during API calls.
- Super Admin can see that an integration exists but cannot view plaintext secrets.
- Landlord can delete credentials.
- Deleting credentials requires PIN.
- Every integration change is audited.

---

## 19. Setup & Readiness Checklist

Create a setup readiness dashboard for landlord.

Statuses:

- not_started
- draft
- needs_credentials
- test_failed
- ready
- live
- disabled

Checklist items:

- Organization profile complete
- Security PIN created
- At least one property created
- At least one unit created
- At least one tenant added
- SMS gateway configured
- M-Pesa gateway configured
- Bank reconciliation ready
- Notification settings configured
- SaaS billing profile active

Do not block landlord from using the app if setup is partial. Show warnings and next steps.

---

## 20. Notifications

Use a unified notification engine.

### 20.1 Priority Levels

Critical:

- Billing lockout
- Security PIN failed
- Unauthorized access attempt
- Integration credential failure

Actionable:

- Unmatched bank/M-Pesa payment
- Rent due
- Overdue invoice
- Meter reading submitted
- SaaS invoice due
- Maintenance request pending

Informational:

- Payment confirmed
- Invoice issued
- System update
- Feature release
- Maintenance status update

### 20.2 Notification Triggers

- RENT_REMINDER -> tenant
- PAYMENT_SUCCESS -> tenant
- INVOICE_ISSUED -> tenant
- OVERDUE_REMINDER -> tenant
- UNALLOCATED_PAYMENT_ALERT -> landlord
- METER_READING_SUBMITTED -> landlord
- BILLING_ALERT -> landlord
- SECURITY_ALERT -> landlord
- MAINTENANCE_CREATED -> landlord/caretaker depending on assignee
- MAINTENANCE_UPDATED -> relevant users

Rules:

- Payment confirmation is sent only after reconciliation.
- Unmatched payment alert goes only to landlord.
- Rent reminder goes to tenant.
- Caretaker does not receive financial reconciliation alerts.
- Failed SMS/WhatsApp/email is logged.

---

## 21. Meter Reading Module

Caretakers can submit meter readings.

### 21.1 Caretaker Flow

1. Open assigned property.
2. Select unit.
3. Enter current reading.
4. Submit.
5. View submission status.

### 21.2 Landlord Flow

1. Review readings.
2. Approve reading.
3. Reject reading.
4. Generate utility invoice item if needed.
5. View history.

Caretaker cannot convert readings to invoices unless enabled later.

---

## 22. SaaS Billing Engine

Smart Landlord charges landlords for using the platform.

### 22.1 Billing Model

Use:

```text
Charge per active tenant
```

At the end of each cycle:

1. Count active tenants.
2. Multiply by price per active tenant.
3. Generate SaaS invoice.
4. Notify landlord.
5. Allow payment by M-Pesa STK Push or bank/paybill.
6. Lock account after grace period if unpaid.
7. Restore access after payment confirmation.

### 22.2 Active Tenant Definition

```text
tenant.status = active
tenant.deleted_at is null
organization.status = active
```

### 22.3 SaaS Billing Enforcement

Grace period:

```text
Day 1: Invoice generated
Day 1-7: SMS/email/in-app reminders
Day 8: Lock organization if unpaid
```

When locked:

```text
organization.is_locked = true
```

Lockout experience:

1. Landlord logs in.
2. App blocks normal functionality.
3. App redirects to Billing Payment screen.
4. Screen shows amount due.
5. Screen shows Pay via M-Pesa STK Push.
6. Screen shows Paybill/bank details configured by Super Admin.
7. After payment confirmation, `organization.is_locked = false`.
8. Access is restored.

Super Admin can manually confirm SaaS billing payment if paid by bank/paybill.

Manual confirmation must be audited.

### 22.4 Super Admin Billing Setup

Super Admin configures:

- Default price per active tenant
- Currency
- Country
- M-Pesa paybill/shortcode
- Bank account details
- Grace period days
- Lockout policy
- Manual payment confirmation rules

---

## 23. Compliance and Data Safety

The app must be Google Play data safety ready.

Include:

- Privacy Policy screen
- Terms screen
- Request Account Deletion screen
- Data Access & API Transparency screen
- Soft delete
- Personal data anonymization where required
- Financial audit retention
- No plaintext secrets
- No hardcoded API keys
- Integration deletion controls
- Audit logs

Data collected:

- Landlord name
- Company name
- Email
- Phone number
- Tenant name
- Tenant phone
- Property data
- Unit data
- Invoices
- Payments
- Bank CSV rows
- Meter readings
- SMS logs
- Audit logs
- Integration metadata

Deletion logic:

- Personal information may be anonymized.
- Financial records are retained for audit/accounting.
- Operational records are soft-deleted.
- Deletion requests are logged.
- API credentials can be deleted by landlord.
- Deleting credentials requires PIN.

---

## 24. Dashboards

### 24.1 Landlord Dashboard

Show:

- Total properties
- Total units
- Occupied units
- Vacant units
- Rent expected this month
- Rent collected this month
- Outstanding balance
- Overdue invoices
- Unmatched bank/M-Pesa payments
- Pending meter readings
- Pending maintenance if module enabled
- Recent payments
- Recent invoices
- SaaS billing status
- Setup readiness status

Actions:

- Tap unmatched payments -> Reconciliation Workbench
- Tap overdue invoices -> filtered invoice list
- Tap vacant units -> filtered unit list
- Tap pending readings -> meter reading review
- Tap SaaS billing -> billing screen
- Tap setup warning -> Setup & Readiness
- Tap pending maintenance -> maintenance list

### 24.2 Caretaker Dashboard

Show:

- Assigned properties
- Assigned units
- Pending meter readings
- Recent submitted readings
- Messages from landlord
- Contact landlord button
- Assigned maintenance requests if enabled

No financial cards.

### 24.3 Super Admin Dashboard

Show:

- Total organizations
- Active organizations
- Locked organizations
- Suspended organizations
- Total active tenants
- Monthly SaaS revenue
- Overdue SaaS invoices
- Manual payments pending confirmation
- Recent impersonation sessions
- System errors
- Failed webhooks
- Failed SMS events

---

## 25. Light Maintenance / Work Orders

Add this in the most logical way without complicating the MVP.

Maintenance is useful for liability protection and operational tracking, but it must not derail the financial core of the product.

### 25.1 Scope

Implement a light work-order module only:

- Landlord or caretaker creates issue.
- Issue is linked to property/unit.
- Issue has status.
- Optional photo.
- Caretaker can update progress/status.
- Landlord can approve/record cost.
- Dashboard shows pending maintenance count.

Do not build:

- Full vendor management
- Procurement
- Inventory
- Expense accounting suite
- Tenant portal reporting unless approved later

### 25.2 Workflow

1. Request created.
2. Landlord/caretaker receives notification.
3. Status changes:

```text
open -> in_progress -> resolved -> closed
```

4. If there is external vendor cost, only landlord can approve/log cost.
5. Every change is timestamped.
6. Cost is linked to property for future reporting.

### 25.3 RBAC

Caretaker can:

- Create request.
- View assigned property requests.
- Update status.
- Add notes/photos.

Caretaker cannot:

- Approve cost.
- View landlord financial ledgers.
- Post expenses to accounting.

Landlord can:

- Create/edit/close requests.
- Assign to caretaker.
- Approve/log cost.
- View maintenance dashboard.

---

## 26. Required Screens

### 26.1 Auth Screens

- Welcome
- Register
- Register as individual/company
- Verify email
- Verify phone
- Login
- Forgot password
- Organization setup
- Create security PIN

### 26.2 Landlord Screens

- Dashboard
- Setup & Readiness
- Integrations
- Property list
- Property detail
- Create/edit property
- Unit list
- Unit detail
- Create/edit unit
- Tenant list
- Tenant detail
- Create/edit tenant
- Invoice list
- Invoice detail
- Create invoice
- Edit draft invoice
- Print-ready invoice
- Payment list
- Payment detail
- Manual payment entry
- Reconciliation Workbench
- Bank CSV upload
- CSV column mapping
- CSV import preview
- Unmatched payment detail
- Manual match screen
- Financial Archive
- Meter reading review
- Caretaker management
- Internal messages
- Reports overview
- Notification settings
- SaaS billing page
- Audit logs under Settings
- Privacy/data deletion
- Maintenance list/detail if enabled

### 26.3 Caretaker Screens

- Caretaker dashboard
- Assigned properties
- Assigned units
- Submit meter reading
- Meter reading history
- Internal messages
- Contact landlord
- Maintenance list/detail if enabled
- Profile

### 26.4 Super Admin Screens

- Platform dashboard
- Landlord organization list
- Landlord organization detail
- Subscription management
- SaaS billing invoices
- Manual payment confirmation
- Global billing settings
- Start impersonation modal
- Impersonation session view
- System audit logs
- System errors
- Support access logs
- Platform integration/payment settings

---

## 27. Mobile UI Requirements

Build mobile-first.

Use:

- Clean dashboard cards
- Bottom navigation
- Rounded cards
- Clear typography
- Status badges
- Good spacing
- Simple charts only where useful
- Empty states
- Loading states
- Error states
- Confirmation dialogs
- Search
- Filters
- Role-aware navigation
- Persistent impersonation banner
- Setup readiness warnings
- Lockout payment screen

The app must feel simple, premium, and practical.

---

## 28. Backend Guardrails

Strictly enforce:

- No tenant-owned query without `organization_id`.
- No caretaker access to financial data.
- No payment reconciled twice.
- No duplicate reference credit.
- No CSV row posted directly without staging.
- No critical action without PIN.
- No plaintext API credentials.
- No Super Admin impersonation without audit log.
- No SaaS lockout without billing invoice and grace period.
- No physical deletion of reconciled financial transactions.
- No cross-organization matching.
- No integration secret visible after save.

---

## 29. Error Handling

Required behavior:

- Clear form validation.
- CSV parsing error messages.
- Duplicate reference detection.
- Failed webhook logging.
- Failed SMS/WhatsApp/email logging.
- Failed reconciliation rollback.
- Atomic posting of transactions.
- System error table.
- User-friendly alerts.

Suggested messages:

Invalid CSV:

```text
The file could not be imported. Please check the date, amount, reference, and description columns.
```

Duplicate payment:

```text
This transaction reference already exists and cannot be posted again.
```

Caretaker restricted access:

```text
You do not have permission to access this financial feature.
```

Wrong PIN:

```text
The security PIN is incorrect. This attempt has been logged.
```

Locked SaaS account:

```text
Your account is temporarily locked due to an overdue platform invoice. Please complete payment to restore access.
```

---

## 30. Build Plan From Scratch to Finish

### Phase 1: Foundation

Build:

- App shell
- Authentication
- Email verification
- Phone verification
- Individual/company registration
- Organization profile
- Organization membership
- Roles
- Tenant isolation
- Security PIN setup
- Basic dashboard shell

Acceptance:

- Landlord can register as individual/company.
- Email and phone are required and verified.
- Organization is created.
- Landlord role is assigned.
- Security PIN can be created.
- User lands on dashboard.

### Phase 2: Properties, Units, Tenants

Build:

- Property CRUD
- Unit CRUD
- Tenant CRUD
- Tenant account number generation
- Occupancy logic
- Caretaker invitation
- Caretaker property assignment

Acceptance:

- Landlord can create property/unit/tenant.
- Unit status updates when tenant is assigned/vacated.
- Caretaker can be assigned to specific properties.
- Caretaker sees only assigned properties.

### Phase 3: Invoices

Build:

- Invoice CRUD
- Invoice items
- Draft/issued/paid/overdue/void statuses
- Balance calculations
- Print-ready invoice

Acceptance:

- Landlord can create draft invoice.
- Draft can be edited.
- Invoice can be issued.
- Void is audited.
- Print-ready view works.

### Phase 4: Payments and Ledger

Build:

- Manual payment entry
- Transactions ledger
- Payment allocation
- Duplicate reference protection
- Tenant balance calculation
- PIN protection for critical actions

Acceptance:

- Manual payment can be posted.
- Invoice balance updates.
- Duplicate reference is blocked.
- Reconciled transactions are immutable.

### Phase 5: Bank Reconciliation

Build:

- Bank CSV upload
- Column mapping
- Reconciliation batches
- Staging rows
- Auto-match suggestions
- Manual matching
- Finalize to ledger
- Audit logs

Acceptance:

- CSV rows stage first.
- Rows can be matched/unmatched/duplicate/invalid.
- Landlord can manually match unmatched row.
- PIN is required to finalize.
- Ledger and invoice balances update.

### Phase 6: M-Pesa/Bank API Readiness

Build:

- Webhook endpoint structure
- Raw payload storage
- Idempotency
- Auto-match logic
- Unmatched routing
- Landlord alerts

Acceptance:

- Webhook detects duplicate reference.
- Matched payment posts to ledger.
- Unmatched payment goes to staging.
- Landlord receives alert.

### Phase 7: Setup & Integrations

Build:

- Setup readiness dashboard
- SMS provider setup
- M-Pesa provider setup
- Bank API setup
- WhatsApp setup
- Encrypted credentials
- Test connection
- Integration logs

Acceptance:

- Landlord can enter provider credentials.
- Credentials are encrypted and masked.
- Test connection status is saved.
- Deleting credentials requires PIN.

### Phase 8: Meter Readings and Communication

Build:

- Caretaker readings
- Landlord review
- In-app messages
- Contact landlord actions
- Notifications

Acceptance:

- Caretaker submits reading.
- Landlord approves/rejects.
- Internal messages work.
- Caretaker cannot access financial data.

### Phase 9: SaaS Billing

Build:

- Per-active-tenant billing
- Platform billing settings
- SaaS invoices
- Grace period reminders
- Lockout screen
- M-Pesa STK payment placeholder/flow
- Bank/paybill payment instructions
- Super Admin manual confirmation
- Automatic unlock

Acceptance:

- Active tenants are counted.
- SaaS invoice is generated.
- Unpaid account locks after grace period.
- Landlord is redirected to billing screen.
- Payment restores access.

### Phase 10: Super Admin

Build:

- Platform dashboard
- Landlord management
- Impersonation
- Support logs
- System audit logs
- System errors
- Billing oversight

Acceptance:

- Super Admin can view organizations.
- Super Admin can impersonate with reason.
- Banner appears during impersonation.
- All support actions are logged.

### Phase 11: Compliance and Polish

Build:

- Privacy policy
- Terms
- Deletion request flow
- Data Access & API Transparency
- Audit logs
- Error handling
- Empty states
- Mobile polish

Acceptance:

- Google Play data safety screens exist.
- Deletion requests are logged.
- API transparency screen exists.
- No secrets are exposed.

### Phase 12: Optional Light Maintenance

Build only after core flows are stable:

- Create maintenance request
- Assign to caretaker
- Track status
- Optional landlord-only cost field

Acceptance:

- Maintenance is operationally useful.
- It does not become a full expense/procurement system.

---

## 31. Final Success Criteria

The MVP is successful when:

- A landlord can register as individual or company.
- Email and phone are verified.
- Landlord can create a security PIN.
- Landlord can create properties, units, and tenants.
- Landlord can assign caretakers to specific properties.
- Caretaker sees only assigned properties and units.
- Caretaker can submit meter readings.
- Caretaker can message/contact landlord.
- Caretaker cannot see financial records.
- Landlord can create invoices.
- Landlord can record payments.
- Landlord can upload bank CSV statements.
- CSV rows go into staging before ledger.
- Landlord can review matched/unmatched payments.
- Landlord can manually reconcile unmatched payments with PIN.
- Invoice balances update correctly.
- Duplicate payments are blocked.
- Landlord can view audit logs under Settings.
- Landlord can configure SMS/M-Pesa/bank/WhatsApp integrations.
- Credentials are encrypted and masked.
- Super Admin can manage landlord organizations.
- Super Admin can impersonate landlord dashboard with audit banner and logs.
- SaaS billing charges per active tenant.
- Unpaid SaaS invoices trigger reminders and lockout after grace period.
- Landlord can pay SaaS invoice via M-Pesa STK or bank/paybill.
- Access restores after payment confirmation.
- The app is secure, clean, mobile-first, and Google Play data-safety ready.

---

## 32. Final Instruction to the Implementation Agent

Build Smart Landlord as a polished mobile-first SaaS MVP.

Focus on the essential operating loop first:

```text
Register landlord -> create organization -> create property -> create units -> add tenants -> create invoices -> record/import payments -> reconcile payments -> update balances -> notify users -> audit actions -> bill landlord SaaS subscription.
```

Do not skip security, tenant isolation, audit logging, PIN protection, or role enforcement.

Do not build decorative screens without functional workflow behind them.

Do not give caretakers financial access.

Do not post bank CSV rows directly into the ledger without staging and landlord review.

Do not expose API credentials in plaintext.

Do not allow duplicate payment credit.

Do not auto-archive financial records; landlord controls archive actions.

Keep the product simple, reliable, and production-minded.

