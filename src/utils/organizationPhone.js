const COUNTRY_DIAL_CODES = Object.freeze({
  kenya: '+254',
  ke: '+254',
  tanzania: '+255',
  tz: '+255',
  uganda: '+256',
  ug: '+256',
  rwanda: '+250',
  rw: '+250',
  ethiopia: '+251',
  et: '+251',
  somalia: '+252',
  so: '+252',
  'south sudan': '+211',
  ss: '+211',
  nigeria: '+234',
  ng: '+234',
  ghana: '+233',
  gh: '+233',
  'south africa': '+27',
  za: '+27',
  'united kingdom': '+44',
  gb: '+44',
  uk: '+44',
  'united states': '+1',
  us: '+1',
  canada: '+1',
  ca: '+1'
});

export function getCountryDialCodeFromOrganization(organization) {
  const country = String(organization?.country || '').trim().toLowerCase();
  return COUNTRY_DIAL_CODES[country] || '+254';
}

export function normalizePhoneForOrganization(rawValue, organization) {
  const cleanedValue = String(rawValue ?? '')
    .trim()
    .replace(/[\s\-()[\]{}]/g, '');

  if (!cleanedValue) return '';
  if (cleanedValue.startsWith('+')) return cleanedValue;
  if (cleanedValue.startsWith('00')) return `+${cleanedValue.slice(2)}`;

  const dialCode = getCountryDialCodeFromOrganization(organization);
  const dialCodeDigits = dialCode.slice(1);

  if (cleanedValue.startsWith(dialCodeDigits)) return `+${cleanedValue}`;
  if (cleanedValue.startsWith('0')) return `${dialCode}${cleanedValue.slice(1)}`;
  return `${dialCode}${cleanedValue}`;
}
