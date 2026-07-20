import assert from 'node:assert';
import fs from 'node:fs';
import { calculateTenantBillingCycle, getClampedDate, formatDateISO, getOrdinalDay } from '../src/utils/billingCycle.js';
import { getCountryDialCodeFromOrganization } from '../src/utils/organizationPhone.js';

console.log('Running Tenant Billing Cycle Test Suite...\n');

let passes = 0;
let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passes++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
    failures++;
  }
}

// 1. Utility functions tests
test('getClampedDate clamps day 31 in February correctly (non-leap year)', () => {
  const febClamped = getClampedDate(2026, 1, 31); // Month 1 = February
  assert.strictEqual(febClamped.getFullYear(), 2026);
  assert.strictEqual(febClamped.getMonth(), 1);
  assert.strictEqual(febClamped.getDate(), 28);
});

test('getClampedDate clamps day 31 in February correctly (leap year)', () => {
  const febLeapClamped = getClampedDate(2028, 1, 31); // 2028 is a leap year
  assert.strictEqual(febLeapClamped.getFullYear(), 2028);
  assert.strictEqual(febLeapClamped.getMonth(), 1);
  assert.strictEqual(febLeapClamped.getDate(), 29);
});

test('getOrdinalDay formats suffixes properly', () => {
  assert.strictEqual(getOrdinalDay(1), '1st');
  assert.strictEqual(getOrdinalDay(2), '2nd');
  assert.strictEqual(getOrdinalDay(3), '3rd');
  assert.strictEqual(getOrdinalDay(4), '4th');
  assert.strictEqual(getOrdinalDay(15), '15th');
  assert.strictEqual(getOrdinalDay(21), '21st');
});

// 2. Billing cycle calculation tests
test('Tenant with billing day 1 renders correct period and next bill date', () => {
  const tenant = { id: 101, billing_day: 1, rent_amount: 30000, status: 'active' };
  const refDate = new Date('2026-07-20T10:00:00Z');
  const cycle = calculateTenantBillingCycle(tenant, [], refDate);

  assert.strictEqual(cycle.billingDay, 1);
  assert.strictEqual(cycle.currentPeriodLabel, 'Jul 1 – Jul 31, 2026');
  assert.strictEqual(cycle.nextBillDateStr, '2026-08-01');
  assert.strictEqual(cycle.nextBillDisplay, 'Aug 1, 2026');
});

test('Tenant with billing day 15 renders correct mid-month period and next bill date', () => {
  const tenant = { id: 102, billing_day: 15, rent_amount: 25000, status: 'active' };
  const refDate = new Date('2026-07-20T10:00:00Z');
  const cycle = calculateTenantBillingCycle(tenant, [], refDate);

  assert.strictEqual(cycle.billingDay, 15);
  assert.strictEqual(cycle.currentPeriodLabel, 'Jul 15 – Aug 14, 2026');
  assert.strictEqual(cycle.nextBillDateStr, '2026-08-15');
});

test('Active tenant with no current-period rent invoice shows unbilled warning', () => {
  const tenant = { id: 103, billing_day: 1, rent_amount: 40000, status: 'active' };
  const refDate = new Date('2026-07-20T10:00:00Z');
  const cycle = calculateTenantBillingCycle(tenant, [], refDate);

  assert.strictEqual(cycle.hasCurrentPeriodInvoice, false);
  assert.strictEqual(cycle.hasUnbilledWarning, true);
});

test('Active tenant with current-period rent invoice does NOT show unbilled warning', () => {
  const tenant = { id: 104, billing_day: 1, rent_amount: 40000, status: 'active' };
  const refDate = new Date('2026-07-20T10:00:00Z');
  const invoices = [
    { id: 1, tenant_id: 104, invoice_type: 'rent', status: 'issued', issue_date: '2026-07-01' }
  ];
  const cycle = calculateTenantBillingCycle(tenant, invoices, refDate);

  assert.strictEqual(cycle.hasCurrentPeriodInvoice, true);
  assert.strictEqual(cycle.hasUnbilledWarning, false);
});

test('Vacated tenant displays next bill as "Not active" and suppresses warning', () => {
  const tenant = { id: 105, billing_day: 1, rent_amount: 35000, status: 'vacated' };
  const refDate = new Date('2026-07-20T10:00:00Z');
  const cycle = calculateTenantBillingCycle(tenant, [], refDate);

  assert.strictEqual(cycle.isVacatedOrInactive, true);
  assert.strictEqual(cycle.nextBillDisplay, 'Not active');
  assert.strictEqual(cycle.hasUnbilledWarning, false);
});

// 3. Static checks on source files
test('Properties.jsx imports billing cycle utilities', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes("from '../utils/billingCycle.js'"), 'Properties.jsx should import billingCycle.js');
});

test('Properties.jsx displays "Outstanding Invoices" instead of misleading "Owes"', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('Outstanding Invoices:'), 'Properties.jsx should use Outstanding Invoices label');
  assert(!content.includes('Owes: <strong'), 'Properties.jsx should not use plain Owes label');
});

test('Properties.jsx contains unbilled rent warning banner text', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('Possible unbilled rent: no rent invoice found for current period.'), 'Properties.jsx should contain warning text');
});

test('Properties.jsx displays Billing Day, Next Bill, and Current Period', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('Billing Day:'), 'Properties.jsx should display Billing Day label');
  assert(content.includes('Next Bill:'), 'Properties.jsx should display Next Bill label');
  assert(content.includes('Current Period:'), 'Properties.jsx should display Current Period label');
});

test('Properties.jsx hides Add Tenant form by default (showAddForm state starts false)', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('const [showAddForm, setShowAddForm] = useState(false);'), 'showAddForm should default to false');
  assert(content.includes('{showAddForm && ('), 'form should be conditionally rendered behind showAddForm');
});

test('Properties.jsx renders action button to toggle showAddForm to true', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('!showAddForm && ('), 'Action button should render when form is hidden');
  assert(content.includes('setShowAddForm(true);'), 'Action button should open form on click');
});

test('Properties.jsx tenant form includes clean header title, subtitle, and helper text', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const tenantForm = content.slice(content.indexOf('{/* TENANT FORM */}'), content.indexOf('{/* CARETAKER FORM */}'));
  const legacyHeading = ['Add New', 'tenant'].join(' ');
  assert.strictEqual((tenantForm.match(/Add New Tenant/g) || []).length, 1, 'Tenant form should render exactly one Add New Tenant title');
  assert(!content.includes(legacyHeading), 'Legacy lowercase tenant heading should be removed');
  assert(content.includes("activeTab !== 'tenants'"), 'Generic form heading should be suppressed for tenant form');
  assert(content.includes("Assign a tenant to a vacant unit and set rent/billing details."), 'Tenant form should contain header subtitle');
  assert(content.includes("Day of the month rent is billed, e.g. 1 for every 1st day."), 'Monthly Billing Day should contain helper text');
});

test('Properties.jsx tenant form uses responsive First Name and Last Name fields', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const styles = fs.readFileSync('src/index.css', 'utf8');
  const tenantForm = content.slice(content.indexOf('{/* TENANT FORM */}'), content.indexOf('{/* CARETAKER FORM */}'));
  const legacyNameLabel = ['Tenant Full', 'Name'].join(' ');
  assert(tenantForm.includes('<div className="tenant-name-grid">'), 'Name fields should use their responsive grid');
  assert(styles.includes('.tenant-name-grid {'), 'Tenant name grid styles should exist');
  assert(styles.includes('@media (max-width: 600px)'), 'Tenant name grid should define a mobile breakpoint');
  assert(styles.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);'), 'Tenant name fields should be side by side on desktop');
  const mobileTenantGrid = styles.slice(styles.indexOf('@media (max-width: 600px)'), styles.indexOf('.grid-3,'));
  assert(mobileTenantGrid.includes('grid-template-columns: 1fr;'), 'Tenant name fields should stack full-width on mobile');
  assert(tenantForm.includes('>First Name</label>'), 'First Name field should exist');
  assert(tenantForm.includes('placeholder="John"'), 'First Name placeholder should be John');
  assert(tenantForm.includes('value={tenantFirstName}'), 'First Name field should use tenantFirstName state');
  assert(tenantForm.includes('>Last Name</label>'), 'Last Name field should exist');
  assert(tenantForm.includes('placeholder="Mwangi"'), 'Last Name placeholder should be Mwangi');
  assert(tenantForm.includes('value={tenantLastName}'), 'Last Name field should use tenantLastName state');
  assert(!tenantForm.includes(legacyNameLabel), 'Legacy combined-name field should no longer exist');
});

test('Properties.jsx combines trimmed first and last names into backend full_name', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const legacyStateName = ['tenant', 'Name'].join('');
  const legacySetterName = ['setTenant', 'Name'].join('');
  assert(content.includes('const fullName = `${tenantFirstName.trim()} ${tenantLastName.trim()}`.trim();'), 'Submit should combine trimmed first and last names');
  assert(content.includes('full_name: fullName'), 'Tenant payload should preserve backend full_name compatibility');
  assert(!content.includes(legacyStateName), 'All legacy combined-name state references should be removed');
  assert(!content.includes(legacySetterName), 'All legacy combined-name setter references should be removed');
});

test('Properties.jsx generates tenant phone examples from the organization country', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const tenantForm = content.slice(content.indexOf('{/* TENANT FORM */}'), content.indexOf('{/* CARETAKER FORM */}'));
  const dynamicPlaceholders = tenantForm.match(/placeholder=\{tenantPhoneExample\}/g) || [];
  const dynamicHelpers = tenantForm.match(/Use international format\. Example: \{tenantPhoneExample\}/g) || [];
  assert(content.includes('getCountryDialCodeFromOrganization(organization)'), 'Tenant dial code should come from the organization');
  assert(content.includes('const tenantPhoneExample = `${tenantDialCode}712345678`;'), 'Tenant phone example should be composed from the derived dial code');
  assert.strictEqual(dynamicPlaceholders.length, 2, 'Main and emergency phone placeholders should both use the dynamic example');
  assert.strictEqual(dynamicHelpers.length, 2, 'Main and emergency phone helpers should both use the dynamic example');
  assert(!content.includes('+254712345678'), 'Properties.jsx should not contain a hardcoded Kenyan phone example');
});

test('organization country maps to the expected tenant phone dial code', () => {
  assert.strictEqual(getCountryDialCodeFromOrganization({ country: 'Kenya' }), '+254');
  assert.strictEqual(getCountryDialCodeFromOrganization({ country: 'KE' }), '+254');
  assert.strictEqual(getCountryDialCodeFromOrganization({ country: 'Uganda' }), '+256');
  assert.strictEqual(getCountryDialCodeFromOrganization({ country: 'Tanzania' }), '+255');
  assert.strictEqual(getCountryDialCodeFromOrganization({}), '+254');
});

test('Properties.jsx blocks missing first or last name without resetting the form', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const handler = content.slice(content.indexOf('const handleTenantSubmit'), content.indexOf('const handlePinSuccess'));
  const validationSection = handler.slice(0, handler.indexOf('const body ='));
  assert(validationSection.includes('if (!tenantFirstName.trim())'), 'Submit should explicitly validate first name');
  assert(validationSection.includes("setError('First name is required.');"), 'Missing first name should show the required error');
  assert(validationSection.includes('if (!tenantLastName.trim())'), 'Submit should explicitly validate last name');
  assert(validationSection.includes("setError('Last name is required.');"), 'Missing last name should show the required error');
  assert(!validationSection.includes('resetTenantForm()'), 'Validation failures should preserve entered form values');
});

test('Properties.jsx tenant reset and Cancel clear both name fields and close the form', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  const resetHandler = content.slice(content.indexOf('const resetTenantForm'), content.indexOf('// Helpers'));
  const tenantForm = content.slice(content.indexOf('{/* TENANT FORM */}'), content.indexOf('{/* CARETAKER FORM */}'));
  assert(resetHandler.includes("setTenantFirstName('');"), 'Tenant reset should clear first name');
  assert(resetHandler.includes("setTenantLastName('');"), 'Tenant reset should clear last name');
  assert(tenantForm.includes('setShowAddForm(false);'), 'Tenant Cancel should close the form');
  assert(tenantForm.includes('resetTenantForm();'), 'Tenant Cancel should reset temporary form state');
});

test('Properties.jsx tenant form contains Cancel and Add & Occupy Unit action buttons', () => {
  const content = fs.readFileSync('src/pages/Properties.jsx', 'utf8');
  assert(content.includes('>Cancel</button>'), 'Form should have Cancel button');
  assert(content.includes('Add & Occupy Unit'), 'Form should have Add & Occupy Unit submit button');
});

test('server.js GET /api/tenants returns last_rent_invoice_date and last_rent_invoice_number', () => {
  const content = fs.readFileSync('server/server.js', 'utf8');
  assert(content.includes('last_rent_invoice_date:'), 'server.js should map last_rent_invoice_date');
  assert(content.includes('last_rent_invoice_number:'), 'server.js should map last_rent_invoice_number');
});

console.log(`\nTenant Billing Cycle Tests Completed: ${passes} passed, ${failures} failed.`);
if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
