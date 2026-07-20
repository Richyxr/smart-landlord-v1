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
