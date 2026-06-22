import React, { useState, useEffect } from 'react';
import SecurityPinModal from '../components/SecurityPinModal.jsx';
import { MessageSquare, Coins, Archive, Lock, FileText, Search, Check, X, Smartphone } from 'lucide-react';

const getChecklistLabel = (key, orgType) => {
  switch (key) {
    case 'property_created': return 'Property Created';
    case 'unit_created': return 'Unit Created';
    case 'tenant_added': return 'Tenant Added';
    case 'sms_configured': return 'SMS Gateway Configured';
    case 'mpesa_configured': return 'Lipa na M-Pesa Configured';
    case 'saas_billing_active': return 'SaaS Billing Active';
    case 'profile_complete': return orgType === 'company' ? 'Company Profile Completed' : 'Profile Completed';
    case 'pin_created': return 'Security PIN Created';
    default: return key.replace(/_/g, ' ');
  }
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  sms_provider: 'None',
  rent_reminders_enabled: false,
  reminder_days_before_due: 3,
  payment_confirmation_enabled: true,
  unmatched_payment_alert_enabled: true,
  meter_reading_alert_enabled: false,
  billing_alerts_enabled: true
};

export default function Settings({ organization, refreshTrigger, onRefresh, initialSubTab, clearInitialSubTab, onNavigate, onUpdateOrganization }) {
  const [activeTab, setActiveTab] = useState(initialSubTab || 'readiness'); // readiness, integrations, archive, audits, compliance, readings
  const [checklist, setChecklist] = useState({});
  const [integrations, setIntegrations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [meterReadings, setMeterReadings] = useState([]);
  const [deletionLog, setDeletionLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Profile Form State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileIdNumber, setProfileIdNumber] = useState('');
  const [localPhone, setLocalPhone] = useState('');
  const [localAltPhone, setLocalAltPhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileCountry, setProfileCountry] = useState('Kenya');
  const [profileCurrency, setProfileCurrency] = useState('KES');
  const [profileType, setProfileType] = useState('individual');
  const [profileBusinessName, setProfileBusinessName] = useState('');
  const [profileRegNum, setProfileRegNum] = useState('');
  const [profileTaxId, setProfileTaxId] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const countryPrefixes = {
    'Kenya': '+254',
    'Uganda': '+256',
    'Tanzania': '+255'
  };

  const countryCurrencies = {
    'Kenya': 'KES',
    'Uganda': 'UGX',
    'Tanzania': 'TZS'
  };

  const getPrefixForCountry = (country) => {
    return countryPrefixes[country] || '+254';
  };

  const stripPrefix = (phone, country) => {
    if (!phone) return '';
    const currentPrefix = getPrefixForCountry(country);
    if (phone.startsWith(currentPrefix)) {
      return phone.substring(currentPrefix.length);
    }
    // Try other prefixes
    for (const p of Object.values(countryPrefixes)) {
      if (phone.startsWith(p)) {
        return phone.substring(p.length);
      }
    }
    return phone;
  };

  useEffect(() => {
    if (organization) {
      const rawName = organization.name || '';
      const parts = (rawName === 'Rental Org' ? '' : rawName).trim().split(/\s+/).filter(Boolean);
      setProfileFirstName(parts[0] || '');
      setProfileLastName(parts.slice(1).join(' ') || '');
      setProfileIdNumber(organization.id_number || organization.registration_number || '');
      setProfileEmail(organization.email || '');
      setProfileCountry(organization.country || 'Kenya');
      setProfileCurrency(organization.billing_currency || 'KES');
      setProfileType(organization.type || 'individual');
      setProfileBusinessName(organization.business_name || '');
      setProfileRegNum(organization.registration_number || '');
      setProfileTaxId(organization.tax_identifier || '');
      
      setLocalPhone(stripPrefix(organization.phone_number || '', organization.country || 'Kenya'));
      setLocalAltPhone(stripPrefix(organization.alt_phone_number || '', organization.country || 'Kenya'));
    }
  }, [organization]);

  // Integration Config State
  const [selectedInt, setSelectedInt] = useState(null); // Integration currently configuring
  const [apiKey, setApiKey] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [senderId, setSenderId] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [shortcode, setShortcode] = useState('');
  const [passkey, setPasskey] = useState('');
  const [env, setEnv] = useState('sandbox');

  // PIN modal triggers
  const [pinAction, setPinAction] = useState(null); // { type: 'delete_int' | 'archive_tx', data: any }
  const [pinTargetId, setPinTargetId] = useState(null);

  // Archive State
  const [archiveDate, setArchiveDate] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]); // 30 days ago
  const [archiveReason, setArchiveReason] = useState('Periodic cleaning');
  const [archiveCount, setArchiveCount] = useState(0);

  // Compliance State
  const [deletionReason, setDeletionReason] = useState('');
  const [targetType, setTargetType] = useState('organization_account');
  const [targetTenantId, setTargetTenantId] = useState('');
  const [tenantsList, setTenantsList] = useState([]);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showDataAccess, setShowDataAccess] = useState(false);

  // Notification State
  const [notifSettings, setNotifSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [notifLogs, setNotifLogs] = useState([]);
  const [smsProviderVal, setSmsProviderVal] = useState('None');

  const headers = {};

  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(initialSubTab);
      clearInitialSubTab?.();
    }
  }, [initialSubTab]);

  useEffect(() => {
    fetchData();
  }, [activeTab, refreshTrigger]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'readiness') {
        const res = await fetch('/api/settings/readiness', { headers });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || 'Failed to fetch readiness status.');
        }
        const data = await res.json();
        setChecklist(data && typeof data === 'object' && data.checklist ? data.checklist : {});
      } else if (activeTab === 'integrations') {
        const res = await fetch('/api/integrations', { headers });
        if (!res.ok) throw new Error('Failed to fetch integrations.');
        const data = await res.json();
        setIntegrations(Array.isArray(data) ? data : (data && Array.isArray(data.integrations) ? data.integrations : []));
      } else if (activeTab === 'archive') {
        // Calculate transactions count before archive date
        const res = await fetch('/api/payments', { headers });
        if (!res.ok) throw new Error('Failed to fetch payments.');
        const txs = await res.json();
        const txsArray = Array.isArray(txs) ? txs : (txs && Array.isArray(txs.payments) ? txs.payments : []);
        const count = txsArray.filter(t => t && t.transaction_date && new Date(t.transaction_date) < new Date(archiveDate) && t.status === 'reconciled').length;
        setArchiveCount(count);
      } else if (activeTab === 'audits') {
        const res = await fetch('/api/settings/audit-logs', { headers });
        if (!res.ok) throw new Error('Failed to fetch audit logs.');
        const data = await res.json();
        setAuditLogs(Array.isArray(data) ? data : (data && Array.isArray(data.audit_logs) ? data.audit_logs : []));
      } else if (activeTab === 'compliance') {
        const [resLog, resTenants] = await Promise.all([
          fetch('/api/compliance/delete-request', { headers }).catch(() => ({ ok: false })),
          fetch('/api/tenants', { headers }).catch(() => ({ ok: false }))
        ]);
        if (resLog && resLog.ok) {
          const data = await resLog.json();
          setDeletionLog(Array.isArray(data) ? data : (data && Array.isArray(data.deletion_log) ? data.deletion_log : []));
        } else {
          setDeletionLog([]);
        }
        if (resTenants && resTenants.ok) {
          const data = await resTenants.json();
          setTenantsList(Array.isArray(data) ? data : (data && Array.isArray(data.tenants) ? data.tenants : []));
        } else {
          setTenantsList([]);
        }
      } else if (activeTab === 'readings') {
        const res = await fetch('/api/meter-readings', { headers });
        if (!res.ok) throw new Error('Failed to fetch meter readings.');
        const data = await res.json();
        setMeterReadings(Array.isArray(data) ? data : (data && Array.isArray(data.meter_readings) ? data.meter_readings : []));
      } else if (activeTab === 'notifications') {
        const settingsRes = await fetch('/api/settings/notifications', { headers }).catch(() => ({ ok: false }));
        let settingsData = null;
        if (settingsRes && settingsRes.ok) {
          settingsData = await settingsRes.json().catch(() => null);
        }
        const mergedSettings = {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          ...(settingsData || {})
        };
        setNotifSettings(mergedSettings);
        setSmsProviderVal(mergedSettings.sms_provider || 'None');

        const logsRes = await fetch('/api/settings/notification-logs', { headers }).catch(() => ({ ok: false }));
        if (logsRes && logsRes.ok) {
          const data = await logsRes.json().catch(() => []);
          setNotifLogs(Array.isArray(data) ? data : (data && Array.isArray(data.notification_logs) ? data.notification_logs : []));
        } else {
          setNotifLogs([]);
        }
      }
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to load settings data.');
    } finally {
      setLoading(false);
    }
  };

  const handleChecklistRowClick = (key) => {
    switch (key) {
      case 'property_created':
        onNavigate?.('landlord_properties', 'properties');
        break;
      case 'unit_created':
        onNavigate?.('landlord_properties', 'units');
        break;
      case 'tenant_added':
        onNavigate?.('landlord_properties', 'tenants');
        break;
      case 'sms_configured':
      case 'mpesa_configured':
        setActiveTab('integrations');
        break;
      case 'saas_billing_active':
        onNavigate?.('landlord_invoices', 'overview');
        break;
      case 'profile_complete':
        setShowProfileModal(true);
        break;
      case 'pin_created':
        alert('Your 6-digit security PIN was configured during registration to protect financial actions.');
        break;
      default:
        break;
    }
  };

  // Archive Trigger change handler
  const handleArchiveDateChange = async (date) => {
    setArchiveDate(date);
    try {
      const res = await fetch('/api/payments', { headers });
      if (!res.ok) {
        setArchiveCount(0);
        setError('Could not load payment records for archive preview.');
        return;
      }
      const txs = await res.json();
      const txsArray = Array.isArray(txs) ? txs : [];
      const count = txsArray.filter(t => t && t.transaction_date && new Date(t.transaction_date) < new Date(date) && t.status === 'reconciled').length;
      setArchiveCount(count);
    } catch (e) {
      setArchiveCount(0);
      setError('Could not load payment records for archive preview.');
    }
  };

  const handleSaveIntegration = async (e) => {
    e.preventDefault();
    setLoading(true);

    const config = {};
    if (selectedInt.provider_type === 'sms') {
      config.api_key = apiKey;
      config.username = apiUsername;
      config.sender_id = senderId;
    } else if (selectedInt.provider_type === 'mpesa') {
      config.consumer_key = consumerKey;
      config.consumer_secret = consumerSecret;
      config.shortcode = shortcode;
      config.passkey = passkey;
    }

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_type: selectedInt.provider_type,
          provider_name: selectedInt.provider_name,
          environment: env,
          config_json: config
        })
      });

      if (!res.ok) throw new Error('Save integration failed.');
      setSelectedInt(null);
      setActiveTab('integrations');
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotifications = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const safeSettings = {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(notifSettings || {})
      };
      const res = await fetch('/api/settings/notifications', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rent_reminders_enabled: safeSettings.rent_reminders_enabled,
          reminder_days_before_due: safeSettings.reminder_days_before_due,
          payment_confirmation_enabled: safeSettings.payment_confirmation_enabled,
          unmatched_payment_alert_enabled: safeSettings.unmatched_payment_alert_enabled,
          meter_reading_alert_enabled: safeSettings.meter_reading_alert_enabled,
          billing_alerts_enabled: safeSettings.billing_alerts_enabled,
          sms_provider: smsProviderVal
        })
      });

      if (!res.ok) throw new Error('Failed to save notification settings.');
      alert('Notification settings saved successfully.');
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryNotification = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/notification-logs/${id}/retry`, {
        method: 'POST',
        headers
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Retry failed.');
      }
      alert('Retry delivery initiated.');
      fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Test failed.');
      const data = await res.json();
      alert(`Test Result: ${data.status.toUpperCase()}\n${data.response_summary}`);
      fetchData();
    } catch (e) {
      alert('Failed to connect to gateway Sandbox.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteIntegrationTrigger = (id) => {
    setPinAction({ type: 'delete_int', id });
  };

  const handleArchiveTrigger = () => {
    if (archiveCount === 0) {
      alert('No reconciled transactions found before this date.');
      return;
    }
    setPinAction({ type: 'archive_tx' });
  };

  const handlePinSuccess = async (enteredPin) => {
    setLoading(true);
    setError('');

    try {
      if (pinAction.type === 'delete_int') {
        const res = await fetch(`/api/integrations/${pinAction.id}/delete`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: enteredPin })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to delete credentials.');
        }
        alert('Credentials deleted.');
      } else if (pinAction.type === 'archive_tx') {
        const res = await fetch('/api/settings/archive', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin: enteredPin,
            before_date: archiveDate,
            reason: archiveReason
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Archive action failed.');
        alert(`Successfully archived ${data.count} transaction records!`);
      }

      setPinAction(null);
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewReading = async (id, status, bill) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meter-readings/${id}/review`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, action_bill: bill })
      });
      if (!res.ok) throw new Error('Review submit failed.');
      fetchData();
      onRefresh();
    } catch (e) {
      setError('Review submit failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitDeletion = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (targetType === 'tenant_data' && !targetTenantId) {
      setError('Please select a tenant for PII anonymization.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/compliance/delete-request', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: targetType,
          reason: deletionReason,
          target_tenant_id: targetType === 'tenant_data' ? targetTenantId : null
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Deletion request failed.');
      }
      alert('Data deletion request submitted successfully. Support team will review within 30 days.');
      setDeletionReason('');
      setTargetTenantId('');
      fetchData();
    } catch (e) {
      setError(e.message || 'Failed to submit deletion request.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');

    if (!profileFirstName.trim()) {
      setProfileError('First Name is required.');
      return;
    }
    if (!profileLastName.trim()) {
      setProfileError('Last Name is required.');
      return;
    }
    if (!profileIdNumber.trim()) {
      setProfileError('ID Number is required.');
      return;
    }
    if (!profileEmail.trim()) {
      setProfileError('Email is required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(profileEmail)) {
      setProfileError('Invalid email address format.');
      return;
    }

    // Phone validation
    const currentPrefix = countryPrefixes[profileCountry] || '+254';
    const cleanPhone = localPhone.trim().replace(/\D/g, '');
    if (!cleanPhone) {
      setProfileError('Phone Number is required.');
      return;
    }
    if (cleanPhone.length < 7 || cleanPhone.length > 15) {
      setProfileError('Invalid Phone Number length.');
      return;
    }
    const finalPhone = currentPrefix + cleanPhone;

    let finalAltPhone = '';
    if (localAltPhone.trim()) {
      const cleanAlt = localAltPhone.trim().replace(/\D/g, '');
      if (cleanAlt.length < 7 || cleanAlt.length > 15) {
        setProfileError('Invalid Alternative Phone Number length.');
        return;
      }
      finalAltPhone = currentPrefix + cleanAlt;
    }

    const fullName = `${profileFirstName.trim()} ${profileLastName.trim()}`;

    setProfileSaving(true);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          first_name: profileFirstName.trim(),
          last_name: profileLastName.trim(),
          name: fullName,
          id_number: profileIdNumber.trim(),
          phone_number: finalPhone,
          alt_phone_number: finalAltPhone,
          email: profileEmail.trim(),
          country: profileCountry,
          billing_currency: profileCurrency,
          type: profileType,
          business_name: profileBusinessName.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update profile.');
      }

      onUpdateOrganization?.(data.organization);
      setShowProfileModal(false);
      fetchData();
      onRefresh();
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const formatCurrency = (val) => {
    const currency = organization?.billing_currency || 'KES';
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(val);
  };

  if (!organization) {
    return (
      <div className="card" style={{ padding: '20px', textAlign: 'center', margin: '20px' }}>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Organization profile is still loading. Please try again in a moment.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>

      {/* PROFILE EDIT MODAL */}
      {showProfileModal && (
        <div className="modal-backdrop" style={{ zIndex: 1100 }}>
          <div className="modal-content">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', marginBottom: '12px' }}>
              Edit Profile
            </h3>

            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">First Name</label>
                  <input
                    type="text"
                    required
                    className="form-control"
                    value={profileFirstName}
                    onChange={e => setProfileFirstName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name</label>
                  <input
                    type="text"
                    required
                    className="form-control"
                    value={profileLastName}
                    onChange={e => setProfileLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">ID Number</label>
                <input
                  type="text"
                  required
                  className="form-control"
                  value={profileIdNumber}
                  onChange={e => setProfileIdNumber(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{
                    padding: '8px 12px',
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '14px',
                    color: 'var(--text-secondary)',
                    userSelect: 'none'
                  }}>
                    {countryPrefixes[profileCountry] || '+254'}
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 712345678"
                    className="form-control"
                    style={{ flex: 1 }}
                    value={localPhone}
                    onChange={e => setLocalPhone(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Alternative Phone Number (Optional)</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{
                    padding: '8px 12px',
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '14px',
                    color: 'var(--text-secondary)',
                    userSelect: 'none'
                  }}>
                    {countryPrefixes[profileCountry] || '+254'}
                  </span>
                  <input
                    type="tel"
                    placeholder="e.g. 789654321"
                    className="form-control"
                    style={{ flex: 1 }}
                    value={localAltPhone}
                    onChange={e => setLocalAltPhone(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="form-control"
                  value={profileEmail}
                  onChange={e => setProfileEmail(e.target.value)}
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <select
                    className="form-control"
                    value={profileCountry}
                    onChange={e => {
                      const val = e.target.value;
                      setProfileCountry(val);
                      setProfileCurrency(countryCurrencies[val] || 'KES');
                    }}
                  >
                    <option value="Kenya">Kenya</option>
                    <option value="Uganda">Uganda</option>
                    <option value="Tanzania">Tanzania</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Billing Currency</label>
                  <select
                    className="form-control"
                    value={profileCurrency}
                    onChange={e => setProfileCurrency(e.target.value)}
                  >
                    <option value="KES">KES</option>
                    <option value="UGX">UGX</option>
                    <option value="TZS">TZS</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Business/Organization Name (Optional)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Kamau Properties"
                  value={profileBusinessName}
                  onChange={e => setProfileBusinessName(e.target.value)}
                />
              </div>

              {profileError && (
                <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', fontWeight: '500' }}>
                  {profileError}
                </div>
              )}

              <div className="flex-gap" style={{ marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowProfileModal(false)} disabled={profileSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PIN SECURITY MODAL */}
      {pinAction && (
        <SecurityPinModal
          isOpen={!!pinAction}
          onClose={() => setPinAction(null)}
          organizationId={organization?.id}
          onSuccess={handlePinSuccess}
        />
      )}

      {/* SETTINGS MENU TABS */}
      {!selectedInt && (
        <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: '16px', background: 'var(--bg-surface)' }}>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'readiness' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'readiness' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('readiness')}
          >
            Checklist
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'integrations' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'integrations' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('integrations')}
          >
            Gateways
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'readings' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'readings' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('readings')}
          >
            Readings
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'archive' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'archive' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('archive')}
          >
            Archive
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'audits' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'audits' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('audits')}
          >
            Audit Logs
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'notifications' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'notifications' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('notifications')}
          >
            Notifications
          </button>
          <button
            style={{ flex: '1 1 30%', padding: '10px 0', border: 'none', background: 'none', color: activeTab === 'compliance' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'compliance' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}
            onClick={() => setActiveTab('compliance')}
          >
            Compliance
          </button>
        </div>
      )}

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

      {/* MAPPING INTEGRATION FORMS */}
      {selectedInt && (
        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selectedInt.provider_type === 'mpesa' && <Smartphone size={16} />}
            Setup {selectedInt.provider_name}
          </h3>
          <form onSubmit={handleSaveIntegration}>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-control" value={env} onChange={e => setEnv(e.target.value)}>
                <option value="sandbox">Sandbox Testing</option>
                <option value="live">Live Production</option>
              </select>
            </div>

            {selectedInt.provider_type === 'sms' && (
              <>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input type="text" required className="form-control" placeholder="sandbox" value={apiUsername} onChange={e => setApiUsername(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input type="password" required className="form-control" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Sender ID</label>
                  <input type="text" required className="form-control" placeholder="SMARTLAND" value={senderId} onChange={e => setSenderId(e.target.value)} />
                </div>
              </>
            )}

            {selectedInt.provider_type === 'mpesa' && (
              <>
                <div className="form-group">
                  <label className="form-label">Lipa na M-Pesa Paybill / Till Number</label>
                  <input type="text" required className="form-control" placeholder="174379" value={shortcode} onChange={e => setShortcode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Consumer Key</label>
                  <input type="text" required className="form-control" placeholder="Consumer Key" value={consumerKey} onChange={e => setConsumerKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Consumer Secret</label>
                  <input type="password" required className="form-control" placeholder="Consumer Secret" value={consumerSecret} onChange={e => setConsumerSecret(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Passkey</label>
                  <input type="password" required className="form-control" placeholder="Passkey" value={passkey} onChange={e => setPasskey(e.target.value)} />
                </div>
              </>
            )}

            <div className="flex-gap" style={{ marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedInt(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save API Keys</button>
            </div>
          </form>
        </div>
      )}

      {/* READINESS CHECKLIST */}
      {activeTab === 'readiness' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="card">
            <h3 className="card-title">Setup & Readiness Checklist</h3>
            <p style={{ fontSize: '12px', marginBottom: '14px' }}>Verify your dashboard config state before receiving live payments.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {checklist && Object.keys(checklist).map(key => (
                <div
                  key={key}
                  className="flex-row setup-row sl-clickable"
                  onClick={() => handleChecklistRowClick(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleChecklistRowClick(key);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    fontSize: '13px',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.2s',
                    outline: 'none'
                  }}
                >
                  <span>{getChecklistLabel(key, organization?.type)}</span>
                  <span className={`badge ${checklist[key] ? 'badge-success' : 'badge-danger'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {checklist[key] ? (
                      <><Check size={12} /> Ready</>
                    ) : (
                      <><X size={12} /> Pending</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* INTEGRATIONS GATEWAYS */}
      {activeTab === 'integrations' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* SMS integration */}
          <div className="card">
            <div className="flex-row">
              <h4 style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}><MessageSquare size={16} /> SMS Gateway (Africa's Talking)</h4>
              <span className={`badge ${integrations.some(i => i.provider_type === 'sms') ? 'badge-success' : 'badge-warning'}`}>
                {integrations.some(i => i.provider_type === 'sms') ? 'connected' : 'draft'}
              </span>
            </div>
            <p style={{ fontSize: '12px', marginTop: '6px' }}>Sends automated rent bills and matching confirmations to tenants.</p>
            <div className="flex-gap" style={{ marginTop: '12px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedInt({ provider_type: 'sms', provider_name: 'Africa’s Talking' })}>Configure</button>
              {integrations.some(i => i.provider_type === 'sms') && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleTestConnection(integrations.find(i => i.provider_type === 'sms').id)}>Test Connection</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteIntegrationTrigger(integrations.find(i => i.provider_type === 'sms').id)}>Delete keys</button>
                </>
              )}
            </div>
          </div>

          {/* M-Pesa Integration */}
          <div className="card">
            <div className="flex-row">
              <h4 style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}><Smartphone size={16} /> Safaricom M-Pesa C2B / STK</h4>
              <span className={`badge ${integrations.some(i => i.provider_type === 'mpesa') ? 'badge-success' : 'badge-warning'}`}>
                {integrations.some(i => i.provider_type === 'mpesa') ? 'connected' : 'draft'}
              </span>
            </div>
            <p style={{ fontSize: '12px', marginTop: '6px' }}>Automates payments matching and reconciliation via webhook callbacks.</p>
            <div className="flex-gap" style={{ marginTop: '12px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedInt({ provider_type: 'mpesa', provider_name: 'Safaricom M-Pesa API' })}>Configure</button>
              {integrations.some(i => i.provider_type === 'mpesa') && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleTestConnection(integrations.find(i => i.provider_type === 'mpesa').id)}>Test</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteIntegrationTrigger(integrations.find(i => i.provider_type === 'mpesa').id)}>Delete keys</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* METER READINGS REVIEW (LANDLORD ONLY) */}
      {activeTab === 'readings' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {meterReadings.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px' }}>No submitted meter readings.</p>
          ) : (
            meterReadings.map(read => (
              <div key={read.id} className="card">
                <div className="flex-row">
                  <span className="badge badge-info">{read.meter_type.toUpperCase()} Reading</span>
                  <span className={`badge ${read.status === 'billed' ? 'badge-success' :
                    read.status === 'approved' ? 'badge-success' :
                      read.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                    }`}>{read.status}</span>
                </div>
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>Unit {read.unit_code} ({read.property_name})</h3>
                <p style={{ fontSize: '12px' }}>Tenant: <strong>{read.tenant_name}</strong> • Date: {read.reading_date}</p>

                <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />

                <div className="grid-2" style={{ fontSize: '12px', background: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px' }}>
                  <div>Prev: <strong>{read.previous_reading}</strong></div>
                  <div>Current: <strong>{read.current_reading}</strong></div>
                  <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>Usage: <strong style={{ color: 'var(--primary)' }}>{read.usage} units</strong></div>
                </div>

                {read.notes && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>Notes: {read.notes}</p>}

                {read.status === 'submitted' && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleReviewReading(read.id, 'rejected', false)}>Reject</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleReviewReading(read.id, 'approved', false)}>Approve Only</button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleReviewReading(read.id, 'approved', true)}>Approve & Bill Tenant</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* FINANCIAL ARCHIVING */}
      {activeTab === 'archive' && !selectedInt && (
        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Archive size={18} /> Financial Archiving
          </h3>
          <p style={{ fontSize: '12px', marginBottom: '16px' }}>
            Hides old reconciled transaction records to clean up dashboards. Archived transactions can still be audited by Super Admin.
          </p>

          <div className="form-group">
            <label className="form-label">Archive records older than</label>
            <input
              type="date"
              className="form-control"
              value={archiveDate}
              onChange={e => handleArchiveDateChange(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Archive Reason</label>
            <input
              type="text"
              className="form-control"
              value={archiveReason}
              onChange={e => setArchiveReason(e.target.value)}
            />
          </div>

          <div style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
            <div>Records found: <strong style={{ color: 'var(--warning)' }}>{archiveCount} transaction(s)</strong></div>
          </div>

          <button
            className="btn btn-danger"
            disabled={archiveCount === 0 || loading}
            onClick={handleArchiveTrigger}
          >
            {loading ? 'Processing...' : 'Archive Reconciled Records (PIN Required)'}
          </button>
        </div>
      )}

      {/* AUDIT LOGS VIEW */}
      {activeTab === 'audits' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {auditLogs.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px' }}>No audit logs found.</p>
          ) : (
            auditLogs.map(log => (
              <div key={log.id} className="card" style={{ padding: '12px', fontSize: '13px' }}>
                <div className="flex-row">
                  <strong style={{ textTransform: 'uppercase', color: 'var(--primary)', fontSize: '11px' }}>{log.action_type.replace(/_/g, ' ')}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <div style={{ marginTop: '6px' }}>
                  Actor: <strong>{log.actor_name}</strong> ({log.actor_role})
                </div>
                {log.reason && <div style={{ color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>Reason: {log.reason}</div>}
              </div>
            ))
          )}
        </div>
      )}

      {/* PRIVACY & COMPLIANCE */}
      {activeTab === 'compliance' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* COMPLIANCE DISCLOSURES */}
          <div className="card">
            <h3 className="card-title">Privacy & Compliance Disclosures</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setShowPrivacy(!showPrivacy)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Lock size={14} /> Privacy Policy</span>
                  <span>{showPrivacy ? '▲' : '▼'}</span>
                </button>
                {showPrivacy && (
                  <div style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '6px', fontSize: '11px', marginTop: '4px', lineHeight: '1.4', color: 'var(--text-secondary)' }}>
                    <p style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}>Smart Landlord Privacy Policy</p>
                    <p style={{ marginBottom: '6px' }}>We collect personal identification details (names, phone numbers, emails), utility meter readings, and invoice ledgers to coordinate landlord operations and automated payment matching.</p>
                    <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '2px' }}>Data Retention Policy:</p>
                    <p>In accordance with accounting and financial audit requirements, all billing records and financial ledgers are retained for a mandatory period of 7 years, even after account deletion. Non-billing personal identities are anonymized on request completion.</p>
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setShowTerms(!showTerms)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={14} /> Terms of Service</span>
                  <span>{showTerms ? '▲' : '▼'}</span>
                </button>
                {showTerms && (
                  <div style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '6px', fontSize: '11px', marginTop: '4px', lineHeight: '1.4', color: 'var(--text-secondary)' }}>
                    <p style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}>Smart Landlord Terms of Service</p>
                    <p style={{ marginBottom: '6px' }}>By configuring and using automated integrations (including Safaricom M-Pesa STK Push and SMS notifications), you authorize Smart Landlord to transmit billing data to verified service gateways on behalf of your organization.</p>
                    <p>Caretaker permissions are restricted strictly to non-financial operational actions. Financial allocations, reversals, and statements remain locked under Landlord credentials.</p>
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setShowDataAccess(!showDataAccess)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Search size={14} /> Data Access & API Transparency</span>
                  <span>{showDataAccess ? '▲' : '▼'}</span>
                </button>
                {showDataAccess && (
                  <div style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: '6px', fontSize: '11px', marginTop: '4px', lineHeight: '1.4', color: 'var(--text-secondary)' }}>
                    <p style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '4px' }}>Third-Party Gateways Disclosures</p>
                    <p style={{ marginBottom: '6px' }}>Smart Landlord shares minimal necessary billing data to facilitate services:</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', border: '1px solid var(--border)' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border)', fontSize: '10px' }}>
                          <th style={{ padding: '4px', textAlign: 'left' }}>Gateway Provider</th>
                          <th style={{ padding: '4px', textAlign: 'left' }}>Shared Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px' }}>Africa's Talking SMS API</td>
                          <td style={{ padding: '4px' }}>Tenant Phone, Bill Invoice Details</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px' }}>Sema SMS Gateway</td>
                          <td style={{ padding: '4px' }}>Tenant Phone, Meter Reading Alert Text</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '4px' }}>Safaricom Daraja API</td>
                          <td style={{ padding: '4px' }}>Payer Phone Number, Invoice Ref, Transaction Ref</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DELETION FORM */}
          <div className="card">
            <h3 className="card-title">Request Account / Data Deletion</h3>
            <p style={{ fontSize: '12px', marginBottom: '14px' }}>
              Submits a formal request to soft-delete or anonymize personal profiles and configurations. In compliance with financial codes, ledger details are retained for 7 years.
            </p>

            <form onSubmit={handleSubmitDeletion}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Deletion Target</label>
                <select
                  className="form-control"
                  value={targetType}
                  onChange={e => {
                    setTargetType(e.target.value);
                    setTargetTenantId('');
                  }}
                >
                  <option value="organization_account">Entire Organization Account (Soft-delete & Anonymize Members)</option>
                  <option value="api_credentials">Wipe API Gateway Credentials (Delete Secrets Only)</option>
                  <option value="tenant_data">Anonymize Specific Tenant Records (PII only, keep invoices)</option>
                </select>
              </div>

              {targetType === 'tenant_data' && (
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label">Select Tenant</label>
                  <select
                    className="form-control"
                    value={targetTenantId}
                    onChange={e => setTargetTenantId(e.target.value)}
                    required
                  >
                    <option value="">-- Choose Tenant --</option>
                    {tenantsList.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.unit_code || 'No Unit'}) - {t.phone_number}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Reason for Request</label>
                <textarea
                  required
                  rows="3"
                  className="form-control"
                  placeholder="Explain the reason for this deletion/anonymization request..."
                  value={deletionReason}
                  onChange={e => setDeletionReason(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-danger btn-sm" disabled={!deletionReason || loading}>
                Submit Deletion Request
              </button>
            </form>
          </div>

          <div className="card">
            <h4 className="card-title" style={{ fontSize: '14px' }}>Request History</h4>
            {deletionLog.length === 0 ? (
              <p style={{ fontSize: '12px', padding: '10px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>No request history.</p>
            ) : (
              deletionLog.map(log => (
                <div key={log.id} className="flex-row" style={{ fontSize: '12px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ textTransform: 'uppercase', color: 'var(--primary)' }}>
                      {log.request_type.replace(/_/g, ' ')}
                    </strong>
                    <div style={{ color: 'var(--text-secondary)' }}>Reason: {log.reason}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Status: <strong>{log.status}</strong> • Created: {new Date(log.created_at).toLocaleDateString()}</div>
                  </div>
                  <span className={`badge ${log.status === 'completed' ? 'badge-success' :
                      log.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                    }`}>
                    {log.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* NOTIFICATIONS TAB */}
      {activeTab === 'notifications' && !selectedInt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <h3 className="card-title">Notification Settings</h3>
            <form onSubmit={handleSaveNotifications}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="rent_reminders_enabled"
                    checked={!!notifSettings.rent_reminders_enabled}
                    onChange={(e) => setNotifSettings({ ...notifSettings, rent_reminders_enabled: e.target.checked })}
                  />
                  <label htmlFor="rent_reminders_enabled" style={{ fontWeight: '500', fontSize: '13px' }}>Rent & Due Reminders</label>
                </div>

                {notifSettings.rent_reminders_enabled && (
                  <div className="form-group" style={{ marginLeft: '24px' }}>
                    <label className="form-label">Send due reminder (days before due date)</label>
                    <input
                      type="number"
                      className="form-control"
                      min="0"
                      value={notifSettings.reminder_days_before_due}
                      onChange={(e) => setNotifSettings({ ...notifSettings, reminder_days_before_due: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="payment_confirmation_enabled"
                    checked={!!notifSettings.payment_confirmation_enabled}
                    onChange={(e) => setNotifSettings({ ...notifSettings, payment_confirmation_enabled: e.target.checked })}
                  />
                  <label htmlFor="payment_confirmation_enabled" style={{ fontWeight: '500', fontSize: '13px' }}>Payment Receipts & Confirmations</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="unmatched_payment_alert_enabled"
                    checked={!!notifSettings.unmatched_payment_alert_enabled}
                    onChange={(e) => setNotifSettings({ ...notifSettings, unmatched_payment_alert_enabled: e.target.checked })}
                  />
                  <label htmlFor="unmatched_payment_alert_enabled" style={{ fontWeight: '500', fontSize: '13px' }}>Unmatched Payment Alerts (to Landlord)</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="meter_reading_alert_enabled"
                    checked={!!notifSettings.meter_reading_alert_enabled}
                    onChange={(e) => setNotifSettings({ ...notifSettings, meter_reading_alert_enabled: e.target.checked })}
                  />
                  <label htmlFor="meter_reading_alert_enabled" style={{ fontWeight: '500', fontSize: '13px' }}>Utility Meter Reading Alerts</label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="billing_alerts_enabled"
                    checked={!!notifSettings.billing_alerts_enabled}
                    onChange={(e) => setNotifSettings({ ...notifSettings, billing_alerts_enabled: e.target.checked })}
                  />
                  <label htmlFor="billing_alerts_enabled" style={{ fontWeight: '500', fontSize: '13px' }}>Platform SaaS Billing Alerts</label>
                </div>

                <div className="form-group" style={{ marginTop: '8px' }}>
                  <label className="form-label">Preferred SMS Provider</label>
                  <select
                    className="form-control"
                    value={smsProviderVal}
                    onChange={(e) => setSmsProviderVal(e.target.value)}
                  >
                    <option value="None">None (Simulator)</option>
                    <option value="AfricasTalking">Africa's Talking</option>
                    <option value="Sema">Sema SMS Gateway</option>
                    <option value="Twilio">Twilio</option>
                  </select>
                </div>

                <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', marginTop: '8px' }}>
                  Save Preferences
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h3 className="card-title">Notification Log History</h3>
            <div style={{ overflowX: 'auto' }}>
              {notifLogs.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No notifications logged yet.
                </div>
              ) : (
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Recipient</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Channel</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Alert Type</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Message</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '8px' }}>Sent Time / Error</th>
                      <th style={{ textAlign: 'center', padding: '8px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifLogs.map((log) => {
                      let statusColor = 'var(--text-secondary)';
                      let statusBg = 'var(--bg-card)';
                      if (log.status === 'sent') {
                        statusColor = '#2e7d32';
                        statusBg = '#e8f5e9';
                      } else if (log.status === 'failed') {
                        statusColor = '#c62828';
                        statusBg = '#ffebee';
                      } else if (log.status === 'pending') {
                        statusColor = '#ef6c00';
                        statusBg = '#fff3e0';
                      }

                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px', fontWeight: '500' }}>{log.phone_number}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ textTransform: 'uppercase', fontSize: '10px', fontWeight: '600' }}>
                              {log.channel}
                            </span>
                          </td>
                          <td style={{ padding: '8px' }}>
                            <code style={{ fontSize: '10px' }}>{log.type}</code>
                          </td>
                          <td style={{ padding: '8px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.message}>
                            {log.message}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: '600',
                              color: statusColor,
                              backgroundColor: statusBg,
                              textTransform: 'uppercase'
                            }}>
                              {log.status}
                            </span>
                          </td>
                          <td style={{ padding: '8px', color: log.status === 'failed' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                            {log.status === 'failed' ? (log.error_message || 'Timeout') : (log.sent_at ? new Date(log.sent_at).toLocaleTimeString() : 'N/A')}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {log.status === 'failed' && (
                              <button
                                className="btn btn-outline"
                                style={{ padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
                                onClick={() => handleRetryNotification(log.id)}
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
