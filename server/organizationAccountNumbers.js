export const ORGANIZATION_ACCOUNT_NUMBER_PATTERN = /^SL-ORG-[0-9]{6,}$/;

export function normalizeOrganizationAccountNumber(value) {
  return String(value || '').trim().toUpperCase();
}

export function isValidOrganizationAccountNumber(value) {
  return ORGANIZATION_ACCOUNT_NUMBER_PATTERN.test(normalizeOrganizationAccountNumber(value));
}

function suffixFromAccountNumber(accountNumber) {
  const match = normalizeOrganizationAccountNumber(accountNumber).match(/^SL-ORG-([0-9]+)$/);
  return match ? Number(match[1]) : 0;
}

export function generateOrganizationAccountNumber(existingOrganizations = []) {
  const used = new Set(
    existingOrganizations
      .map(org => normalizeOrganizationAccountNumber(org?.account_number))
      .filter(Boolean)
  );

  let next = existingOrganizations.reduce((max, org) => {
    return Math.max(max, Number(org?.id || 0), suffixFromAccountNumber(org?.account_number));
  }, 0) + 1;

  while (true) {
    const candidate = `SL-ORG-${String(next).padStart(6, '0')}`;
    if (!used.has(candidate)) return candidate;
    next += 1;
  }
}
