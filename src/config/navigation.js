export const LANDLORD_PRIMARY_NAV = [
  { id: 'home', label: 'Home', path: '/home' },
  { id: 'properties', label: 'Properties', path: '/properties' },
  { id: 'billing', label: 'Billing', path: '/billing' },
  { id: 'stats', label: 'Stats', path: '/stats' },
  { id: 'settings', label: 'Settings', path: '/settings' }
];

export const LANDLORD_PROPERTY_SECTIONS = [
  'properties',
  'units',
  'tenants',
  'staff'
];

export const LANDLORD_BILLING_SECTIONS = [
  'overview',
  'invoices',
  'payments',
  'banking',
  'utilities'
];

export const LANDLORD_BANKING_SECTIONS = [
  'import',
  'matching',
  'history',
  'payments'
];

export const LANDLORD_SETTINGS_SECTIONS = [
  'readiness',
  'integrations',
  'security-pin',
  'caretaker-readings',
  'archive',
  'audit-logs',
  'notifications',
  'compliance'
];

export const SUPER_ADMIN_SECTIONS = [
  { id: 'dashboard', label: 'Overview', path: '/admin' },
  { id: 'landlords', label: 'Landlords', path: '/admin/landlords' },
  { id: 'billing', label: 'Confirm SaaS', path: '/admin/billing' },
  { id: 'email', label: 'Email', path: '/admin/email' },
  { id: 'sms', label: 'SMS Gateway', path: '/admin/sms' },
  { id: 'errors', label: 'Errors', path: '/admin/errors' },
  { id: 'audits', label: 'System Logs', path: '/admin/audits' },
  { id: 'compliance', label: 'Compliance', path: '/admin/compliance' }
];

export const CARETAKER_SECTIONS = [
  { id: 'dashboard', label: 'Home', path: '/caretaker' },
  { id: 'readings', label: 'Readings', path: '/caretaker/readings' },
  { id: 'messages', label: 'Messages', path: '/caretaker/messages' },
  { id: 'profile', label: 'Profile', path: '/caretaker/profile' }
];

export function getRoleHomePath(role) {
  if (role === 'super_admin') return '/admin';
  if (role === 'caretaker') return '/caretaker';
  return '/home';
}

export function getAuthRedirectPath(role, organization) {
  if (role === 'landlord' && organization && organization.profile_completed === false) {
    return '/complete-profile';
  }
  return getRoleHomePath(role);
}

export function normalizeLandlordSection(section) {
  if (!section) return 'properties';
  if (section === 'staff') return 'staff';
  return LANDLORD_PROPERTY_SECTIONS.includes(section) ? section : 'properties';
}

export function normalizeBillingSection(section) {
  if (!section) return 'overview';
  if (section === 'banking') return 'banking';
  return LANDLORD_BILLING_SECTIONS.includes(section) ? section : 'overview';
}

export function normalizeBankingSection(section) {
  if (!section) return 'import';
  return LANDLORD_BANKING_SECTIONS.includes(section) ? section : 'import';
}

export function normalizeSettingsSection(section) {
  if (!section) return 'readiness';
  const normalized = String(section).replace(/_/g, '-');
  return LANDLORD_SETTINGS_SECTIONS.includes(normalized) ? normalized : 'readiness';
}

export function normalizeAdminSection(section) {
  const normalized = section || 'dashboard';
  return SUPER_ADMIN_SECTIONS.some(item => item.id === normalized) ? normalized : 'dashboard';
}

export function normalizeCaretakerSection(section) {
  const normalized = section || 'dashboard';
  return CARETAKER_SECTIONS.some(item => item.id === normalized) ? normalized : 'dashboard';
}

export function getLandlordPrimaryPath() {
  return '/home';
}
