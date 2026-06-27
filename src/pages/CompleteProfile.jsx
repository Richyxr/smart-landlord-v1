import React, { useState } from 'react';
import { setSessionToken } from '../lib/session.js';

export default function CompleteProfile({ user, organization, onComplete }) {
  const [isCompany, setIsCompany] = useState(organization?.type === 'company');
  const [country, setCountry] = useState(organization?.country || 'Kenya');
  const [currency, setCurrency] = useState(organization?.billing_currency || 'KES');

  // Step 1: Details fields
  const [firstName, setFirstName] = useState(user?.first_name || user?.name?.split(' ')[0] || '');
  const [lastName, setLastName] = useState(user?.last_name || user?.name?.split(' ').slice(1).join(' ') || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone_number ? user.phone_number.replace(/^\+254|^\+256|^\+255/, '') : '');
  
  const [companyName, setCompanyName] = useState(organization?.name || '');
  const [regNum, setRegNum] = useState(organization?.registration_number || '');
  const [taxId, setTaxId] = useState(organization?.tax_identifier || '');

  const [representativeFirstName, setRepresentativeFirstName] = useState(organization?.representative_first_name || '');
  const [representativeLastName, setRepresentativeLastName] = useState(organization?.representative_last_name || '');
  const [representativeRole, setRepresentativeRole] = useState(organization?.representative_role || '');
  const [representativePhone, setRepresentativePhone] = useState(organization?.representative_phone_e164 ? organization.representative_phone_e164.replace(/^\+254|^\+256|^\+255/, '') : '');
  const [representativeEmail, setRepresentativeEmail] = useState(organization?.representative_email || '');
  const [representativeAuthorized, setRepresentativeAuthorized] = useState(organization?.representative_authorized || false);

  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [step, setStep] = useState(1); // 1 = details, 2 = review
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (step === 1) {
      if (isCompany) {
        if (!companyName.trim()) return setError('Company name is required.');
        if (!regNum.trim()) return setError('Business registration number is required.');
        if (!taxId.trim()) return setError('KRA PIN / Tax Identifier is required.');
        if (!representativeFirstName.trim() || !representativeLastName.trim()) {
          return setError('Representative first and last names are required.');
        }
        if (!representativeRole.trim()) return setError('Representative role/title is required.');
        if (!emailRegex.test(representativeEmail)) {
          return setError('Invalid representative email address format.');
        }
        if (!representativePhone.trim()) return setError('Representative phone number is required.');
      } else {
        if (!firstName.trim() || !lastName.trim()) {
          return setError('First name and last name are required.');
        }
      }

      if (!emailRegex.test(email)) {
        return setError('Invalid email address format.');
      }
      if (!phone.trim()) {
        return setError('Phone number is required.');
      }

      setStep(2);
      return;
    }

    if (!profileConfirmed) {
      return setError('You must confirm the profile details are accurate.');
    }
    if (isCompany && !representativeAuthorized) {
      return setError('You must confirm you are authorized to represent the company.');
    }

    setLoading(true);

    const prefix = country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '';
    
    // Normalize main phone
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (!normalizedPhone.startsWith('+') && !normalizedPhone.startsWith('254') && !normalizedPhone.startsWith('256') && !normalizedPhone.startsWith('255')) {
      if (normalizedPhone.startsWith('0')) normalizedPhone = normalizedPhone.substring(1);
      normalizedPhone = prefix + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+' + normalizedPhone;
    }

    // Normalize rep phone
    let normalizedRepPhone = '';
    if (isCompany && representativePhone) {
      normalizedRepPhone = representativePhone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
      if (!normalizedRepPhone.startsWith('+') && !normalizedRepPhone.startsWith('254') && !normalizedRepPhone.startsWith('256') && !normalizedRepPhone.startsWith('255')) {
        if (normalizedRepPhone.startsWith('0')) normalizedRepPhone = normalizedRepPhone.substring(1);
        normalizedRepPhone = prefix + normalizedRepPhone;
      } else if (!normalizedRepPhone.startsWith('+')) {
        normalizedRepPhone = '+' + normalizedRepPhone;
      }
    }

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          type: isCompany ? 'company' : 'individual',
          first_name: firstName,
          last_name: lastName,
          email,
          phone_number: normalizedPhone,
          country,
          billing_currency: currency,
          company_name: companyName,
          registration_number: regNum,
          tax_identifier: taxId,
          representative_first_name: representativeFirstName,
          representative_last_name: representativeLastName,
          representative_role: representativeRole,
          representative_phone_e164: normalizedRepPhone,
          representative_email: representativeEmail,
          representative_authorized: representativeAuthorized,
          profile_confirmed: profileConfirmed
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to complete profile.');
      }

      setSessionToken(data.auth_token);
      onComplete(data.user, 'landlord', data.organization, data.auth_token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="auth-panel">
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img
            src="/icons/maskable-192.png"
            alt="Smart Landlord"
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 10px auto',
              display: 'block',
              borderRadius: '14px',
              boxShadow: '0 8px 20px rgba(99, 102, 241, 0.22)'
            }}
          />
          <h1 style={{
            fontFamily: 'var(--font-title)',
            fontSize: '22px',
            fontWeight: '700',
            margin: '0 0 2px 0',
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em'
          }}>
            Smart <span style={{ color: 'var(--primary)' }}>Landlord</span>
          </h1>
          <p style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            margin: '0 0 4px 0',
            fontWeight: '500'
          }}>
            Property management made simple.
          </p>
          <p style={{
            fontSize: '10px',
            color: 'var(--primary)',
            opacity: 0.85,
            margin: 0,
            fontWeight: '600',
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}>
            Secure property management portal
          </p>
        </div>

        <h2 style={{ fontSize: '18px', marginBottom: '4px', textAlign: 'center', fontWeight: '600' }}>
          {step === 1 ? 'Complete Your Profile' : 'Confirm Your Details'}
        </h2>
        <p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>
          {step === 1 ? 'Please fill out your identity and representative details.' : 'Please review and confirm your profile details.'}
        </p>

        <form onSubmit={handleSubmit}>
          {step === 1 ? (
            <>
              <div className="form-group">
                <label className="form-label">Profile Type</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className={`btn ${!isCompany ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    style={{ flex: 1 }}
                    onClick={() => setIsCompany(false)}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    className={`btn ${isCompany ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    style={{ flex: 1 }}
                    onClick={() => setIsCompany(true)}
                  >
                    Company
                  </button>
                </div>
              </div>

              {isCompany ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Company Name</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      placeholder="Kamau Properties Ltd"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                    />
                  </div>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Reg. Number</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="CPR/2022/123"
                        value={regNum}
                        onChange={e => setRegNum(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">KRA PIN</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="P051234567A"
                        value={taxId}
                        onChange={e => setTaxId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ margin: '20px 0 10px 0', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Representative Details</h3>
                  </div>

                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Rep. First Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Maina"
                        value={representativeFirstName}
                        onChange={e => setRepresentativeFirstName(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Rep. Last Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Kamau"
                        value={representativeLastName}
                        onChange={e => setRepresentativeLastName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Rep. Role / Title</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      placeholder="Director"
                      value={representativeRole}
                      onChange={e => setRepresentativeRole(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Rep. Email</label>
                    <input
                      type="email"
                      required
                      className="form-control"
                      placeholder="rep@kamauproperties.co.ke"
                      value={representativeEmail}
                      onChange={e => setRepresentativeEmail(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Rep. Phone Number</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={{
                        padding: '8px 12px',
                        background: 'var(--bg-surface-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--text-secondary)'
                      }}>
                        {country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '+'}
                      </span>
                      <input
                        type="tel"
                        required
                        className="form-control"
                        placeholder="7XXXXXXXX"
                        value={representativePhone}
                        onChange={e => setRepresentativePhone(e.target.value.replace(/[^0-9]/g, ''))}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">First Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Maina"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Last Name</label>
                      <input
                        type="text"
                        required
                        className="form-control"
                        placeholder="Kamau"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">KRA PIN (Optional)</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="P051234567A"
                      value={taxId}
                      onChange={e => setTaxId(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div style={{ margin: '20px 0 10px 0', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Contact Settings</h3>
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="form-control"
                  placeholder="landlord@demo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{
                    padding: '8px 12px',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--text-secondary)'
                  }}>
                    {country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '+'}
                  </span>
                  <input
                    type="tel"
                    required
                    className="form-control"
                    placeholder="7XXXXXXXX"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <select className="form-control" value={country} onChange={e => {
                    setCountry(e.target.value);
                    if (e.target.value === 'Kenya') setCurrency('KES');
                    else if (e.target.value === 'Uganda') setCurrency('UGX');
                    else if (e.target.value === 'Tanzania') setCurrency('TZS');
                  }}>
                    <option value="Kenya">Kenya</option>
                    <option value="Uganda">Uganda</option>
                    <option value="Tanzania">Tanzania</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-control" value={currency} onChange={e => setCurrency(e.target.value)}>
                    <option value="KES">KES</option>
                    <option value="UGX">UGX</option>
                    <option value="TZS">TZS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: 'var(--bg-surface-elevated)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '20px', fontSize: '13px', lineHeight: '1.6' }}>
                {isCompany ? (
                  <>
                    <div style={{ marginBottom: '8px' }}><strong>Company Name:</strong> {companyName}</div>
                    <div style={{ marginBottom: '8px' }}><strong>Reg. Number:</strong> {regNum}</div>
                    <div style={{ marginBottom: '8px' }}><strong>KRA PIN:</strong> {taxId}</div>
                    <div style={{ margin: '12px 0 8px 0', borderTop: '1px solid var(--border)', paddingTop: '8px' }}><strong>Representative:</strong> {representativeFirstName} {representativeLastName} ({representativeRole})</div>
                    <div style={{ marginBottom: '8px' }}><strong>Rep. Email:</strong> {representativeEmail}</div>
                    <div style={{ marginBottom: '8px' }}><strong>Rep. Phone:</strong> {(country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '') + representativePhone}</div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: '8px' }}><strong>Landlord Name:</strong> {firstName} {lastName}</div>
                    {taxId && <div style={{ marginBottom: '8px' }}><strong>KRA PIN:</strong> {taxId}</div>}
                  </>
                )}
                <div style={{ margin: '12px 0 8px 0', borderTop: '1px solid var(--border)', paddingTop: '8px' }}><strong>Account Email:</strong> {email}</div>
                <div style={{ marginBottom: '8px' }}><strong>Account Phone:</strong> {(country === 'Kenya' ? '+254' : country === 'Uganda' ? '+256' : country === 'Tanzania' ? '+255' : '') + phone}</div>
                <div style={{ marginBottom: '8px' }}><strong>Country:</strong> {country}</div>
                <div><strong>Currency:</strong> {currency}</div>
              </div>

              {isCompany && (
                <label className="checkbox-container" style={{ display: 'flex', gap: '8px', marginBottom: '12px', fontSize: '12px', cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    required
                    checked={representativeAuthorized}
                    onChange={e => setRepresentativeAuthorized(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>I confirm I am authorized to represent this company.</span>
                </label>
              )}

              <label className="checkbox-container" style={{ display: 'flex', gap: '8px', marginBottom: '20px', fontSize: '12px', cursor: 'pointer', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  required
                  checked={profileConfirmed}
                  onChange={e => setProfileConfirmed(e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <span>I confirm that all details are accurate.</span>
              </label>
            </>
          )}

          {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
            {step === 2 && (
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>
                Edit Details
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Saving Profile...' : step === 1 ? 'Continue' : 'Confirm & Complete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
