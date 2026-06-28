import React, { useState, useEffect } from 'react';
import {
  Settings,
  Building2,
  Mail,
  ShieldCheck,
  TestTube2,
  Pencil,
  MessageSquare,
  BarChart3,
  CreditCard,
  AlertTriangle,
  FileText,
  X
} from 'lucide-react';

const tabIcons = {
  dashboard: BarChart3,
  landlords: Building2,
  billing: CreditCard,
  email: Mail,
  sms: MessageSquare,
  errors: AlertTriangle,
  audits: FileText,
  compliance: ShieldCheck
};

function getTabIcon(tabId) {
  return tabIcons[tabId] || Settings;
}

function getSectionDescription(tabId) {
  const descriptions = {
    dashboard: "Global platform metrics, SaaS revenue overview, and pricing configuration.",
    landlords: "Manage registered organizations, edit account numbers, and impersonate landlord views.",
    billing: "Manually confirm bank deposits and unlock pending landlord subscriptions.",
    email: "Configure global SMTP server details for registration, OTPs, and system alerts.",
    sms: "Manage SMS gateway providers, default country settings, pricing, and landlord billing.",
    errors: "Monitor unhandled application exceptions and server stack traces.",
    audits: "Audit trails of admin actions and platform configuration changes.",
    compliance: "Process compliance requests, GDPR data deletes, and tenant anonymity options."
  };
  return descriptions[tabId] || "";
}

const DEFAULT_STATS = {
  total_organizations: 0,
  active_organizations: 0,
  locked_organizations: 0,
  active_rental_tenants: 0,
  billable_tenants: 0,
  total_active_tenants: 0,
  monthly_saas_revenue: 0,
  lifetime_saas_revenue: 0,
  pending_confirmations: 0,
  system_errors_count: 0
};

const ORG_ACCOUNT_NUMBER_PATTERN = /^SL-ORG-[0-9]{6,}$/;

const SUPER_ADMIN_TABS = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'landlords', label: 'Landlords' },
  { id: 'billing', label: 'Confirm SaaS' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS Gateway' },
  { id: 'errors', label: 'Errors' },
  { id: 'audits', label: 'System Logs' },
  { id: 'compliance', label: 'Compliance' }
];

function toFiniteNumber(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAccountNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function formatMoney(value, currency = 'KES') {
  const numeric = Number(value || 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return `${currency} ${safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeArrayPayload(payload) {
  return Array.isArray(payload) ? payload : [];
}

const SMS_FIELD_LABELS = {
  api_key: 'API Key',
  api_key_header_name: 'API Key Header Name',
  bearer_token: 'Bearer Token',
  callback_url: 'Callback URL',
  client_id: 'Partner ID / Client ID',
  password: 'Password',
  service_id: 'Service ID',
  username: 'Username'
};

const SMS_SENSITIVE_FIELDS = new Set(['api_key', 'bearer_token', 'client_id', 'password', 'username']);

function smsFieldLabel(field) {
  return SMS_FIELD_LABELS[field] || field;
}

export default function SuperAdmin({ activeRoute, onImpersonateStart, refreshTrigger, onRefresh }) {
  const routeTabMap = {
    admin_dashboard: 'dashboard',
    admin_orgs: 'landlords',
    admin_pricing: 'dashboard',
    admin_errors: 'errors',
    admin_email: 'email'
  };

  const [activeTab, setActiveTab] = useState(routeTabMap[activeRoute] || 'dashboard'); // dashboard, landlords, billing, email, errors, audits
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    const nextTab = routeTabMap[activeRoute];
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeRoute]);
  const [stats, setStats] = useState(DEFAULT_STATS);

  const [landlords, setLandlords] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [systemErrors, setSystemErrors] = useState([]);
  const [systemAudits, setSystemAudits] = useState([]);
  const [deletionRequests, setDeletionRequests] = useState([]);
  const [platformEmail, setPlatformEmail] = useState({
    status: 'not_configured',
    last_tested_at: null,
    config_masked: {},
    has_credentials: false
  });
  const [platformEmailForm, setPlatformEmailForm] = useState({
    host: '',
    port: '465',
    secure: true,
    username: '',
    password: '',
    from_email: '',
    from_name: 'Smart Landlord',
    reply_to: ''
  });
  const [platformEmailPasswordMasked, setPlatformEmailPasswordMasked] = useState(false);

  // Platform SMS state
  const [platformSms, setPlatformSms] = useState({
    provider: '',
    provider_key: '',
    provider_profile: null,
    api_url: '',
    sender_id: 'SMARTLANDY',
    sender_id_type: 'transactional',
    sender_approval_status: 'pending',
    default_country_code: '+254',
    status: 'not_configured',
    last_tested_at: null,
    sms_last_error: null,
    config_masked: {},
    has_credentials: false,
    readiness: { checklist: [] }
  });
  const [smsProviderProfiles, setSmsProviderProfiles] = useState([]);
  const [smsUsage, setSmsUsage] = useState({
    summary: {
      sent_today: 0,
      sent_month: 0,
      failed_month: 0,
      blocked_month: 0,
      provider_cost_month: '0.00',
      billed_revenue_month: '0.00',
      margin_month: '0.00',
      active_landlords_month: 0
    },
    landlords: []
  });
  const [platformSmsForm, setPlatformSmsForm] = useState({
    provider: '',
    api_url: '',
    sender_id: 'SMARTLANDY',
    sender_id_type: 'transactional',
    sender_approval_status: 'pending',
    default_country_code: '+254',
    api_key: '',
    api_key_header_name: '',
    bearer_token: '',
    callback_url: '',
    client_id: '',
    password: '',
    service_id: '',
    username: ''
  });
  const [smsPricingForm, setSmsPricingForm] = useState({
    sms_billing_enabled: false,
    default_sms_provider_cost: '0.0000',
    default_sms_sell_price: '0.0000',
    sms_currency: 'KES'
  });
  const [platformSmsCredentialsMasked, setPlatformSmsCredentialsMasked] = useState(false);

  // Pricing Form
  const [pricePerTenant, setPricePerTenant] = useState('200');
  const [gracePeriod, setGracePeriod] = useState('7');

  // Impersonate Modal
  const [impersonateOrg, setImpersonateOrg] = useState(null);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [accountNumberOrg, setAccountNumberOrg] = useState(null);
  const [accountNumberValue, setAccountNumberValue] = useState('');
  const [accountNumberError, setAccountNumberError] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = {};

  useEffect(() => {
    fetchStats();
    fetchData();
  }, [activeTab, refreshTrigger]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', { headers });
      if (!res.ok) {
        throw new Error('Failed to fetch platform stats.');
      }

      const payload = await res.json();
      const source = payload && typeof payload === 'object' ? payload : {};

      setStats({
        ...DEFAULT_STATS,
        total_organizations: toFiniteNumber(source.total_organizations),
        active_organizations: toFiniteNumber(source.active_organizations),
        locked_organizations: toFiniteNumber(source.locked_organizations),
        active_rental_tenants: toFiniteNumber(source.active_rental_tenants, toFiniteNumber(source.total_active_tenants)),
        billable_tenants: toFiniteNumber(source.billable_tenants, toFiniteNumber(source.total_active_tenants)),
        total_active_tenants: toFiniteNumber(source.total_active_tenants),
        monthly_saas_revenue: toFiniteNumber(source.monthly_saas_revenue),
        lifetime_saas_revenue: toFiniteNumber(source.lifetime_saas_revenue, toFiniteNumber(source.monthly_saas_revenue)),
        pending_confirmations: toFiniteNumber(source.pending_confirmations),
        system_errors_count: toFiniteNumber(source.system_errors_count)
      });
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'dashboard') {
        const res = await fetch('/api/admin/pricing', { headers });
        if (res.ok) {
          const data = await res.json();
          setPricePerTenant(String(data.price_per_active_tenant ?? '200'));
          setGracePeriod(String(data.grace_period_days ?? '7'));
        }
      } else if (activeTab === 'landlords') {
        const res = await fetch('/api/admin/organizations', { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setLandlords([]);
          throw new Error(data?.message || data?.error || 'Failed to fetch landlords.');
        }
        setLandlords(safeArrayPayload(data));
      } else if (activeTab === 'billing') {
        const res = await fetch('/api/admin/platform-payments', { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setPendingPayments([]);
          throw new Error(data?.message || data?.error || 'Failed to fetch platform payments.');
        }
        const payments = safeArrayPayload(data);
        setPendingPayments(payments.filter(p => p?.status === 'pending'));
      } else if (activeTab === 'email') {
        const res = await fetch('/api/admin/platform-email', { headers });
        if (!res.ok) throw new Error('Failed to fetch platform email settings.');
        const data = await res.json();
        setPlatformEmail(data);
        setPlatformEmailForm({
          host: data.config_masked?.host || '',
          port: String(data.config_masked?.port || '465'),
          secure: data.config_masked?.secure !== false,
          username: data.config_masked?.username || '',
          password: '',
          from_email: data.config_masked?.from_email || '',
          from_name: data.config_masked?.from_name || 'Smart Landlord',
          reply_to: data.config_masked?.reply_to || ''
        });
        setPlatformEmailPasswordMasked(Boolean(data.has_credentials));
      } else if (activeTab === 'sms') {
        const providerRes = await fetch('/api/admin/platform-sms/providers', { headers });
        if (!providerRes.ok) throw new Error('Failed to fetch SMS provider profiles.');
        const providerData = await providerRes.json();
        setSmsProviderProfiles(safeArrayPayload(providerData.providers));

        const res = await fetch('/api/admin/platform-sms', { headers });
        if (!res.ok) throw new Error('Failed to fetch platform SMS settings.');
        const data = await res.json();
        setPlatformSms(data);
        setSmsPricingForm({
          sms_billing_enabled: Boolean(data.sms_billing_enabled),
          default_sms_provider_cost: String(data.default_sms_provider_cost ?? '0.0000'),
          default_sms_sell_price: String(data.default_sms_sell_price ?? '0.0000'),
          sms_currency: data.sms_currency || 'KES'
        });
        setPlatformSmsForm({
          provider: data.provider || '',
          api_url: data.api_url || '',
          sender_id: data.sender_id || 'SMARTLANDY',
          sender_id_type: data.sender_id_type || 'transactional',
          sender_approval_status: data.sender_approval_status || 'pending',
          default_country_code: data.default_country_code || '+254',
          api_key: '',
          api_key_header_name: data.config_masked?.api_key_header_name || '',
          bearer_token: '',
          callback_url: data.config_masked?.callback_url || '',
          client_id: data.config_masked?.client_id || '',
          password: '',
          service_id: data.config_masked?.service_id || '',
          username: data.config_masked?.username || ''
        });
        setPlatformSmsCredentialsMasked(Boolean(data.has_credentials));

        const usageRes = await fetch('/api/admin/platform-sms/usage', { headers });
        if (!usageRes.ok) throw new Error('Failed to fetch SMS usage.');
        const usageData = await usageRes.json();
        setSmsUsage({
          summary: usageData.summary || smsUsage.summary,
          landlords: safeArrayPayload(usageData.landlords)
        });
      } else if (activeTab === 'errors') {
        const res = await fetch('/api/admin/system-errors', { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSystemErrors([]);
          throw new Error(data?.message || data?.error || 'Failed to fetch system errors.');
        }
        setSystemErrors(safeArrayPayload(data));
      } else if (activeTab === 'audits') {
        const res = await fetch('/api/admin/system-audits', { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSystemAudits([]);
          throw new Error(data?.message || data?.error || 'Failed to fetch system logs.');
        }
        setSystemAudits(safeArrayPayload(data));
      } else if (activeTab === 'compliance') {
        const res = await fetch('/api/admin/compliance/delete-requests', { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setDeletionRequests([]);
          throw new Error(data?.message || data?.error || 'Failed to fetch compliance requests.');
        }
        setDeletionRequests(safeArrayPayload(data));
      }
    } catch (e) {
      setError(e?.message || 'Failed to fetch platform records.');
    } finally {
      setLoading(false);
    }
  };

  const handlePricingSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_per_active_tenant: pricePerTenant, grace_period_days: gracePeriod })
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        window.notifySuccess('Pricing settings saved', 'The platform pricing policy has been updated.');
        fetchStats();
        fetchData();
        onRefresh();
      } else {
        const errMsg = data?.error || data?.message || 'Failed to update pricing.';
        setError(errMsg);
        window.notifyError('Pricing update failed', errMsg);
      }
    } catch (e) {
      setError('Failed to update pricing.');
      window.notifyError('Connection problem', 'Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPayment = async (payId) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/confirm-payment', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: payId })
      });
      if (res.ok) {
        window.notifySuccess('SaaS Payment Confirmed', 'The organization has been unlocked.');
        fetchData();
        fetchStats();
        onRefresh();
      }
    } catch (e) {
      setError('Confirm failed.');
    } finally {
      setLoading(false);
    }
  };

  const openAccountNumberEditor = (org) => {
    setAccountNumberOrg(org);
    setAccountNumberValue(normalizeAccountNumber(org.account_number));
    setAccountNumberError('');
  };

  const closeAccountNumberEditor = () => {
    setAccountNumberOrg(null);
    setAccountNumberValue('');
    setAccountNumberError('');
  };

  const handleAccountNumberSubmit = async (e) => {
    e.preventDefault();
    const normalized = normalizeAccountNumber(accountNumberValue);

    if (!normalized) {
      setAccountNumberError('Account number is required.');
      return;
    }

    if (!ORG_ACCOUNT_NUMBER_PATTERN.test(normalized)) {
      setAccountNumberError('Use the format SL-ORG-000001.');
      return;
    }

    setLoading(true);
    setError('');
    setAccountNumberError('');
    try {
      const res = await fetch(`/api/admin/organizations/${accountNumberOrg.id}/account-number`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: normalized })
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to update account number.');
      }

      const updatedOrg = data?.organization;
      if (updatedOrg) {
        setLandlords(prev => prev.map(org => org.id === updatedOrg.id ? { ...org, ...updatedOrg } : org));
      }

      closeAccountNumberEditor();
      fetchData();
      fetchStats();
      onRefresh();
    } catch (err) {
      setAccountNumberError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformEmailSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        host: platformEmailForm.host.trim(),
        port: Number.parseInt(platformEmailForm.port, 10),
        secure: platformEmailForm.secure,
        username: platformEmailForm.username.trim(),
        from_email: platformEmailForm.from_email.trim() || platformEmailForm.username.trim(),
        from_name: platformEmailForm.from_name.trim() || 'Smart Landlord',
        reply_to: platformEmailForm.reply_to.trim()
      };

      if (!platformEmailPasswordMasked || platformEmailForm.password.trim()) {
        payload.password = platformEmailForm.password;
      }

      const res = await fetch('/api/admin/platform-email', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_json: payload })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save platform email settings.');

      setPlatformEmail(data);
      setPlatformEmailPasswordMasked(true);
      setPlatformEmailForm(prev => ({ ...prev, password: '' }));
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformEmailTest = async () => {
    window.showPrompt(
      'Send Test Email',
      'Enter a test recipient email address (leave blank to use your account email):',
      '',
      async (recipient) => {
        if (recipient === null) return;
        setLoading(true);
        setError('');
        try {
          const res = await fetch('/api/admin/platform-email/test', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(recipient.trim() ? { to: recipient.trim() } : {})
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || data.message || 'Failed to send platform email test.');
          setPlatformEmail(prev => ({ ...prev, status: data.status || 'active', last_tested_at: data.last_tested_at || new Date().toISOString() }));
          window.notifySuccess('Test Email Sent', 'Platform test email was successfully dispatched.');
          onRefresh();
        } catch (err) {
          setError(err.message);
          window.notifyError('Test Email Failed', err.message);
        } finally {
          setLoading(false);
        }
      }
    );
  };

  const handlePlatformSmsSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        api_key: platformSmsForm.api_key.trim(),
        api_key_header_name: platformSmsForm.api_key_header_name.trim(),
        bearer_token: platformSmsForm.bearer_token.trim(),
        callback_url: platformSmsForm.callback_url.trim(),
        client_id: platformSmsForm.client_id.trim(),
        password: platformSmsForm.password.trim(),
        service_id: platformSmsForm.service_id.trim(),
        username: platformSmsForm.username.trim()
      };

      const body = {
        provider: platformSmsForm.provider.trim(),
        api_url: platformSmsForm.api_url.trim(),
        sender_id: platformSmsForm.sender_id.trim() || 'SMARTLANDY',
        sender_id_type: platformSmsForm.sender_id_type,
        sender_approval_status: platformSmsForm.sender_approval_status,
        default_country_code: platformSmsForm.default_country_code.trim() || '+254',
        config_json: payload
      };

      if (platformSmsCredentialsMasked) {
        body.config_json = {
          ...payload,
          api_key: '********',
          bearer_token: '********',
          client_id: '********',
          password: '********',
          username: '********'
        };
      }

      const res = await fetch('/api/admin/platform-sms', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save platform SMS settings.');

      setPlatformSms(data);
      setPlatformSmsCredentialsMasked(true);
      setPlatformSmsForm(prev => ({ ...prev, api_key: '', bearer_token: '', password: '', username: '' }));
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSmsPricingSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const providerCost = Number(smsPricingForm.default_sms_provider_cost);
      const sellPrice = Number(smsPricingForm.default_sms_sell_price);
      const currency = String(smsPricingForm.sms_currency || '').trim().toUpperCase();

      if (!Number.isFinite(providerCost) || providerCost < 0) {
        throw new Error('Provider cost cannot be negative.');
      }
      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        throw new Error('Billing price cannot be negative.');
      }
      if (!currency) {
        throw new Error('Currency is required.');
      }

      const res = await fetch('/api/admin/platform-sms/pricing', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sms_billing_enabled: smsPricingForm.sms_billing_enabled,
          default_sms_provider_cost: smsPricingForm.default_sms_provider_cost,
          default_sms_sell_price: smsPricingForm.default_sms_sell_price,
          sms_currency: currency
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save SMS pricing settings.');

      setPlatformSms(data);
      setSmsPricingForm({
        sms_billing_enabled: Boolean(data.sms_billing_enabled),
        default_sms_provider_cost: String(data.default_sms_provider_cost ?? '0.0000'),
        default_sms_sell_price: String(data.default_sms_sell_price ?? '0.0000'),
        sms_currency: data.sms_currency || 'KES'
      });
      await fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformSmsTest = async () => {
    window.showPrompt(
      'Send Test SMS',
      'Enter a test recipient mobile phone number (e.g. +254700000000):',
      '',
      async (recipient) => {
        if (recipient === null || !recipient.trim()) return;
        setLoading(true);
        setError('');
        try {
          const res = await fetch('/api/admin/platform-sms/test', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: recipient.trim() })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || data.message || 'Failed to send platform SMS test.');
          setPlatformSms(prev => ({
            ...prev,
            status: data.status || 'active',
            last_tested_at: data.last_tested_at || new Date().toISOString(),
            sms_last_error: null
          }));
          window.notifySuccess('Test SMS Sent', 'Platform test SMS was successfully dispatched.');
          await fetchData();
          onRefresh();
        } catch (err) {
          setError(err.message);
          window.notifyError('Test SMS Failed', err.message);
        } finally {
          setLoading(false);
        }
      }
    );
  };

  const handleProcessDeletion = async (requestId, action) => {
    if (action === 'reject') {
      window.showPrompt(
        'Reject Deletion Request',
        'Enter reason for rejection:',
        '',
        async (reasonVal) => {
          if (!reasonVal || !reasonVal.trim()) {
            window.notifyWarning('Validation Error', 'Reason is required for rejection.');
            return;
          }
          await executeProcessDeletion(requestId, action, reasonVal.trim());
        }
      );
    } else {
      window.showConfirm(
        'Approve Deletion Request',
        'Are you sure you want to APPROVE this deletion request? This will permanently anonymize personal identity data (PII) and cannot be undone.',
        async () => {
          await executeProcessDeletion(requestId, action, '');
        }
      );
    }
  };

  const executeProcessDeletion = async (requestId, action, reason) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/compliance/delete-requests/${requestId}/process`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reject_reason: reason })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to process request.');
      }

      window.notifySuccess('Action Successful', `Request has been successfully ${action === 'approve' ? 'approved & data anonymized' : 'rejected'}.`);
      fetchData();
      fetchStats();
      onRefresh();
    } catch (err) {
      setError(err.message);
      window.notifyError('Action Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonateSubmit = async (e) => {
    e.preventDefault();
    if (!impersonateReason.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate/start', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: impersonateOrg.id, reason: impersonateReason })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start impersonation.');

      onImpersonateStart(data.session, data.targetOrg, data.ownerUser, data.auth_token);
      setImpersonateOrg(null);
      setImpersonateReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(toFiniteNumber(val));
  };

  const safeStats = {
    total_organizations: toFiniteNumber(stats.total_organizations),
    active_rental_tenants: toFiniteNumber(stats.active_rental_tenants, toFiniteNumber(stats.total_active_tenants)),
    billable_tenants: toFiniteNumber(stats.billable_tenants, toFiniteNumber(stats.total_active_tenants)),
    total_active_tenants: toFiniteNumber(stats.total_active_tenants),
    locked_organizations: toFiniteNumber(stats.locked_organizations),
    pending_confirmations: toFiniteNumber(stats.pending_confirmations),
    monthly_saas_revenue: toFiniteNumber(stats.monthly_saas_revenue),
    lifetime_saas_revenue: toFiniteNumber(stats.lifetime_saas_revenue)
  };
  const safeLandlords = safeArrayPayload(landlords);
  const safePendingPayments = safeArrayPayload(pendingPayments);
  const safeSystemErrors = safeArrayPayload(systemErrors);
  const safeSystemAudits = safeArrayPayload(systemAudits);
  const safeDeletionRequests = safeArrayPayload(deletionRequests);
  const smsSummary = smsUsage.summary || {};
  const smsCurrency = smsPricingForm.sms_currency || platformSms.sms_currency || 'KES';
  const smsLandlordRows = safeArrayPayload(smsUsage.landlords);
  const selectedSmsProviderKey = platformSmsForm.provider || platformSms.provider_key || platformSms.provider || '';
  const selectedSmsProviderProfile = smsProviderProfiles.find(profile => profile.provider_key === selectedSmsProviderKey) || platformSms.provider_profile || null;
  const selectedSmsConfigFields = selectedSmsProviderProfile
    ? Array.from(new Set([
      ...(selectedSmsProviderProfile.required_credentials || []),
      ...(selectedSmsProviderProfile.optional_credentials || []),
      ...(selectedSmsProviderProfile.required_static_fields || []).filter(field => field !== 'api_url')
    ]))
    : ['api_key'];
  const smsReadinessRows = safeArrayPayload(platformSms.readiness?.checklist);

  const activeSuperAdminSection = SUPER_ADMIN_TABS.find(tab => tab.id === activeTab) || SUPER_ADMIN_TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* IMPERSONATION MODAL REASON INPUT */}
      {impersonateOrg && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="card-title">Impersonate {impersonateOrg.name}</h3>
            <p style={{ fontSize: '12px', marginBottom: '14px' }}>
              You are about to access this landlord's dashboard. Under policy guidelines, this support action must have an audit trail.
            </p>

            <form onSubmit={handleImpersonateSubmit}>
              <div className="form-group">
                <label className="form-label">Reason for Support Access</label>
                <textarea
                  required
                  rows="3"
                  className="form-control"
                  placeholder="e.g. Debugging CSV column mapping issue for customer ticket #9081"
                  value={impersonateReason}
                  onChange={e => setImpersonateReason(e.target.value)}
                />
              </div>

              <div className="flex-gap" style={{ marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setImpersonateOrg(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Start Impersonation</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ACCOUNT NUMBER EDIT MODAL */}
      {accountNumberOrg && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="card-title">Edit Account Number</h3>
            <p style={{ fontSize: '12px', marginBottom: '14px', color: 'var(--text-secondary)' }}>
              {accountNumberOrg.name}
            </p>

            <form onSubmit={handleAccountNumberSubmit}>
              <div className="form-group">
                <label className="form-label">Account Number</label>
                <input
                  required
                  className="form-control"
                  value={accountNumberValue}
                  onChange={e => {
                    setAccountNumberValue(e.target.value);
                    setAccountNumberError('');
                  }}
                  onBlur={e => setAccountNumberValue(normalizeAccountNumber(e.target.value))}
                  placeholder="SL-ORG-000001"
                />
              </div>

              {accountNumberError && (
                <div role="alert" style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '12px' }}>
                  {accountNumberError}
                </div>
              )}

              <div className="flex-gap" style={{ marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeAccountNumberEditor}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="super-admin-layout">
        {/* Workspace Content */}
        <main className="super-admin-workspace">
          {/* Mobile manage sections controls */}
          <div className="super-admin-mobile-nav">
            <div className="super-admin-mobile-nav-header">
              <div>
                <span className="form-label" style={{ marginBottom: '2px', display: 'block', fontSize: '9px', color: 'var(--text-muted)' }}>Workspace</span>
                <h2 className="super-admin-workspace-title" style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{activeSuperAdminSection.label}</h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsDrawerOpen(true)}
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700 }}
              >
                Manage sections
              </button>
            </div>
          </div>

          {/* Desktop workspace headers */}
          <div className="super-admin-workspace-header">
            <h1 className="super-admin-workspace-title" style={{ fontSize: '24px', fontWeight: 800, margin: 0 }}>{activeSuperAdminSection.label}</h1>
            <p className="super-admin-workspace-desc" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{getSectionDescription(activeTab)}</p>
          </div>

          {/* Desktop segmented section switcher */}
          <nav className="super-admin-desktop-switcher">
            {SUPER_ADMIN_TABS.map(tab => {
              const Icon = getTabIcon(tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`super-admin-switcher-item ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px', padding: '10px', background: 'var(--danger-glow)', borderLeft: '3px solid var(--danger)', borderRadius: '4px' }}>{error}</div>}

          <div className="super-admin-content-area">

      {/* OVERVIEW PLATFORM STATS */}
      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div className="super-admin-metrics-grid">
            <div className="sl-metric-card">
              <div className="sl-metric-top">
                <span className="sl-metric-label">Total Landlords</span>
                <Building2 size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div className="sl-metric-value">{safeStats.total_organizations}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-top">
                <span className="sl-metric-label">Active Tenants</span>
                <Building2 size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div className="sl-metric-value">{safeStats.active_rental_tenants}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-top">
                <span className="sl-metric-label">Billable Tenants</span>
                <Building2 size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div className="sl-metric-value">{safeStats.billable_tenants}</div>
            </div>
            <div className={`sl-metric-card ${safeStats.locked_organizations > 0 ? 'sl-metric-danger' : ''}`}>
              <div className="sl-metric-top">
                <span className="sl-metric-label">Locked Accounts</span>
                <ShieldCheck size={16} style={{ color: safeStats.locked_organizations > 0 ? 'var(--danger)' : 'var(--text-secondary)' }} />
              </div>
              <div className="sl-metric-value" style={{ color: safeStats.locked_organizations > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                {safeStats.locked_organizations}
              </div>
            </div>
            <div className={`sl-metric-card ${safeStats.pending_confirmations > 0 ? 'sl-metric-warning' : ''}`}>
              <div className="sl-metric-top">
                <span className="sl-metric-label">Confirmations</span>
                <CreditCard size={16} style={{ color: safeStats.pending_confirmations > 0 ? 'var(--warning)' : 'var(--text-secondary)' }} />
              </div>
              <div className="sl-metric-value" style={{ color: safeStats.pending_confirmations > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {safeStats.pending_confirmations}
              </div>
            </div>
          </div>

          <div className="super-admin-overview-bottom">
            <div className="sl-card sl-card-success" style={{ marginBottom: 0 }}>
              <span className="kpi-lbl">This Month SaaS Revenue</span>
              <div className="kpi-num" style={{ color: 'var(--success)', fontSize: '28px', marginTop: '8px' }}>
                {formatCurrency(safeStats.monthly_saas_revenue)}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Lifetime SaaS Revenue: <strong>{formatCurrency(safeStats.lifetime_saas_revenue)}</strong>
              </div>
            </div>

            {/* PRICING SETTINGS FORM */}
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} /> Global Platform Pricing
              </h3>
              <form onSubmit={handlePricingSubmit}>
                <div className="form-group">
                  <label className="form-label">Price per Active Tenant (Monthly KES)</label>
                  <input
                    type="number"
                    required
                    className="form-control"
                    value={pricePerTenant}
                    onChange={e => setPricePerTenant(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Unpaid Invoice Grace Period (Days)</label>
                  <input
                    type="number"
                    required
                    className="form-control"
                    value={gracePeriod}
                    onChange={e => setGracePeriod(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
                  Update Pricing Policy
                </button>
              </form>
            </div>
          </div>

        </div>
      )}

      {/* LANDLORDS LIST */}
      {activeTab === 'landlords' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {safeLandlords.length === 0 ? (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="sl-empty-state-title">No landlords found yet.</div>
              <div className="sl-empty-state-desc">Organizations will appear here once landlord accounts are created.</div>
            </div>
          ) : (
            safeLandlords.map(org => (
              <div key={org.id} className="sl-list-card">
                <div className="flex-row">
                  <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Building2 size={18} style={{ color: 'var(--primary)' }} />
                    <span>{org.name}</span>
                  </h3>
                  <span className={`badge ${org.is_locked ? 'badge-danger' : 'badge-success'}`}>
                    {org.is_locked ? 'locked' : 'active'}
                  </span>
                </div>
                <p style={{ fontSize: '12px', marginTop: '2px' }}>Owner ID: {org.owner_user_id} • Country: {org.country}</p>
                <div style={{ fontSize: '12px', marginTop: '6px' }}>
                  Account Number: <strong style={{ color: 'var(--primary)' }}>{org.account_number || 'Not assigned'}</strong>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: 'var(--bg-surface-elevated)', padding: '6px', borderRadius: '4px', margin: '8px 0' }}>
                  <span>Sub: <strong>{org.subscription_tier.toUpperCase()}</strong></span>
                  <span>Active Tenants: <strong>{toFiniteNumber(org.active_tenant_count)}</strong></span>
                </div>

                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => openAccountNumberEditor(org)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Pencil size={12} /> Edit Account
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setImpersonateOrg(org)}
                  >
                    Impersonate Dashboard
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* CONFIRM SAAS PAYMENTS */}
      {activeTab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {safePendingPayments.length === 0 ? (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="sl-empty-state-title">No pending SaaS billing confirmations.</div>
              <div className="sl-empty-state-desc">Incoming pending platform payment confirmations will appear here.</div>
            </div>
          ) : (
            safePendingPayments.map(pay => (
              <div key={pay.id} className="sl-list-card">
                <div className="flex-row">
                  <span className="badge badge-warning">{pay.payment_method.toUpperCase()} Payment</span>
                  <span className="badge badge-danger">pending confirmation</span>
                </div>
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>{pay.organization_name}</h3>
                <p style={{ fontSize: '12px' }}>Ref: <strong>{pay.reference_number}</strong> • Date: {new Date(pay.created_at).toLocaleString()}</p>
                
                <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                
                <div className="flex-row" style={{ fontSize: '13px', marginBottom: '12px' }}>
                  <span>Amount:</span>
                  <strong style={{ color: 'var(--success)', fontSize: '16px' }}>{formatCurrency(pay.amount)}</strong>
                </div>

                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleConfirmPayment(pay.id)}
                >
                  Confirm Bank Deposit & Unlock Org
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* PLATFORM EMAIL */}
      {activeTab === 'email' && (
        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mail size={18} /> Platform Email
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Used for registration OTP, password reset later, and platform/system emails.
          </p>

          <div className="flex-row" style={{ marginBottom: '12px' }}>
            <span className={`badge ${
              platformEmail.status === 'active' ? 'badge-success' :
              platformEmail.status === 'test_failed' ? 'badge-danger' :
              platformEmail.status === 'verified' ? 'badge-info' :
              platformEmail.status === 'needs_credentials' ? 'badge-warning' :
              'badge-secondary'
            }`}>
              {
                platformEmail.status === 'active' ? 'Active' :
                platformEmail.status === 'test_failed' ? 'Failed' :
                platformEmail.status === 'verified' ? 'Configured (Untested)' :
                platformEmail.status === 'needs_credentials' ? 'Needs Credentials' :
                'Not Configured'
              }
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Last tested: {platformEmail.last_tested_at ? new Date(platformEmail.last_tested_at).toLocaleString() : 'Never'}
            </span>
          </div>

          {platformEmail.smtp_last_error && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '14px', padding: '10px', background: 'var(--bg-surface-elevated)', borderLeft: '3px solid var(--danger)', borderRadius: '4px' }}>
              <strong>Last Error:</strong> {platformEmail.smtp_last_error}
            </div>
          )}

          <form onSubmit={handlePlatformEmailSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">SMTP Host</label>
                <input className="form-control" value={platformEmailForm.host} onChange={e => setPlatformEmailForm(prev => ({ ...prev, host: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">SMTP Port</label>
                <input type="number" className="form-control" value={platformEmailForm.port} onChange={e => setPlatformEmailForm(prev => ({ ...prev, port: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Secure (TLS/SSL)</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={platformEmailForm.secure} onChange={e => setPlatformEmailForm(prev => ({ ...prev, secure: e.target.checked }))} />
                <span>{platformEmailForm.secure ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="form-control" value={platformEmailForm.username} onChange={e => setPlatformEmailForm(prev => ({ ...prev, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                {platformEmailPasswordMasked ? (
                  <div className="flex-row" style={{ gap: '8px' }}>
                    <input className="form-control" value="••••••••" readOnly />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlatformEmailPasswordMasked(false)}>Update</button>
                  </div>
                ) : (
                  <input type="password" className="form-control" value={platformEmailForm.password} onChange={e => setPlatformEmailForm(prev => ({ ...prev, password: e.target.value }))} />
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">From Email</label>
                <input className="form-control" value={platformEmailForm.from_email} onChange={e => setPlatformEmailForm(prev => ({ ...prev, from_email: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">From Name</label>
                <input className="form-control" value={platformEmailForm.from_name} onChange={e => setPlatformEmailForm(prev => ({ ...prev, from_name: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Reply-To</label>
              <input className="form-control" value={platformEmailForm.reply_to} onChange={e => setPlatformEmailForm(prev => ({ ...prev, reply_to: e.target.value }))} />
            </div>

            <div className="flex-gap" style={{ marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>Save Platform Email</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handlePlatformEmailTest} disabled={loading || !platformEmail.has_credentials}>Send Test Email</button>
            </div>
          </form>
        </div>
      )}

      {/* PLATFORM SMS GATEWAY */}
      {activeTab === 'sms' && (
        <div className="card super-admin-sms-card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquare size={18} /> Platform SMS Gateway
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Used for system alerts, notifications, and tenant messaging.
          </p>

          <div className="flex-row super-admin-sms-status-row" style={{ marginBottom: '12px' }}>
            <span className={`badge ${
              platformSms.status === 'active' ? 'badge-success' :
              platformSms.status === 'test_failed' ? 'badge-danger' :
              platformSms.status === 'verified' ? 'badge-info' :
              platformSms.status === 'disabled' ? 'badge-secondary' :
              'badge-secondary'
            }`}>
              {
                platformSms.status === 'active' ? 'Active' :
                platformSms.status === 'test_failed' ? 'Failed' :
                platformSms.status === 'verified' ? 'Configured (Untested)' :
                platformSms.status === 'disabled' ? 'Disabled' :
                'Not Configured'
              }
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Last tested: {platformSms.last_tested_at ? new Date(platformSms.last_tested_at).toLocaleString() : 'Never'}
            </span>
          </div>

          {platformSms.sms_last_error && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '14px', padding: '10px', background: 'var(--bg-surface-elevated)', borderLeft: '3px solid var(--danger)', borderRadius: '4px' }}>
              <strong>Last Error:</strong> {platformSms.sms_last_error}
            </div>
          )}

          <div className="super-admin-readiness-panel" style={{ marginBottom: '16px', padding: '14px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>Provider Readiness</h4>
            <div className="grid-3 super-admin-readiness-grid">
              {smsReadinessRows.map(item => (
                <div key={item.key} className="super-admin-readiness-item" style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', background: 'var(--bg-surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <strong style={{ fontSize: '12px' }}>{item.label}</strong>
                    <span className={`badge ${item.ok ? 'badge-success' : item.status === 'blocked' ? 'badge-danger' : 'badge-secondary'}`}>
                      {item.ok ? 'Ready' : item.status === 'blocked' ? 'Blocked' : 'Missing'}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontSize: '12px' }}>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid-4 super-admin-sms-kpis" style={{ marginBottom: '16px' }}>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Sent Today</div>
              <div className="sl-metric-value">{toFiniteNumber(smsSummary.sent_today)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Sent Month</div>
              <div className="sl-metric-value">{toFiniteNumber(smsSummary.sent_month)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Failed</div>
              <div className="sl-metric-value">{toFiniteNumber(smsSummary.failed_month)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Blocked</div>
              <div className="sl-metric-value">{toFiniteNumber(smsSummary.blocked_month)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Provider cost this month</div>
              <div className="sl-metric-value" style={{ fontSize: '18px' }}>{formatMoney(smsSummary.provider_cost_month, smsCurrency)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Billed revenue this month</div>
              <div className="sl-metric-value" style={{ fontSize: '18px' }}>{formatMoney(smsSummary.billed_revenue_month, smsCurrency)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">SMS margin this month</div>
              <div className="sl-metric-value" style={{ fontSize: '18px' }}>{formatMoney(smsSummary.margin_month, smsCurrency)}</div>
            </div>
            <div className="sl-metric-card">
              <div className="sl-metric-label">Landlords active this month</div>
              <div className="sl-metric-value">{toFiniteNumber(smsSummary.active_landlords_month)}</div>
            </div>
          </div>

          <details className="super-admin-mobile-section" open>
            <summary>SMS Pricing</summary>
            <form onSubmit={handleSmsPricingSave} className="super-admin-sms-pricing-form" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px', padding: '14px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '14px' }}>SMS Pricing Controls</h4>
            <div className="grid-4">
              <div className="form-group">
                <label className="form-label">Provider Cost / SMS</label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="form-control"
                  value={smsPricingForm.default_sms_provider_cost}
                  onChange={e => setSmsPricingForm(prev => ({ ...prev, default_sms_provider_cost: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Billing Price / SMS</label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="form-control"
                  value={smsPricingForm.default_sms_sell_price}
                  onChange={e => setSmsPricingForm(prev => ({ ...prev, default_sms_sell_price: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <input
                  className="form-control"
                  value={smsPricingForm.sms_currency}
                  onChange={e => setSmsPricingForm(prev => ({ ...prev, sms_currency: e.target.value.toUpperCase() }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Billing Enabled</label>
                <select
                  className="form-control"
                  value={smsPricingForm.sms_billing_enabled ? 'enabled' : 'disabled'}
                  onChange={e => setSmsPricingForm(prev => ({ ...prev, sms_billing_enabled: e.target.value === 'enabled' }))}
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
            <div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>Save SMS Pricing</button>
            </div>
            </form>
          </details>

          <details className="super-admin-mobile-section" open>
            <summary>Provider Settings</summary>
            <form onSubmit={handlePlatformSmsSave} className="super-admin-sms-provider-form" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">SMS Provider</label>
                <select
                  className="form-control"
                  value={platformSmsForm.provider}
                  onChange={e => {
                    setPlatformSmsCredentialsMasked(false);
                    setPlatformSmsForm(prev => ({ ...prev, provider: e.target.value }));
                  }}
                  required
                >
                  <option value="">Select provider</option>
                  {smsProviderProfiles.map(profile => (
                    <option key={profile.provider_key} value={profile.provider_key}>{profile.provider_display_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Advanced / Custom API URL</label>
                <input className="form-control" value={platformSmsForm.api_url} placeholder="Provider API base URL when required" onChange={e => setPlatformSmsForm(prev => ({ ...prev, api_url: e.target.value }))} />
              </div>
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Sender ID</label>
                <input className="form-control" value={platformSmsForm.sender_id} onChange={e => setPlatformSmsForm(prev => ({ ...prev, sender_id: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Sender ID Type</label>
                <select className="form-control" value={platformSmsForm.sender_id_type} onChange={e => setPlatformSmsForm(prev => ({ ...prev, sender_id_type: e.target.value }))}>
                  <option value="transactional">Transactional</option>
                  <option value="promotional">Promotional</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Default Country Code</label>
                <input className="form-control" value={platformSmsForm.default_country_code} onChange={e => setPlatformSmsForm(prev => ({ ...prev, default_country_code: e.target.value }))} required />
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Sender Approval Status</label>
                <select className="form-control" value={platformSmsForm.sender_approval_status} onChange={e => setPlatformSmsForm(prev => ({ ...prev, sender_approval_status: e.target.value }))}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Status Override</label>
                <select className="form-control" value={platformSms.status} onChange={async (e) => {
                  const nextStatus = e.target.value;
                  try {
                    const res = await fetch('/api/admin/platform-sms', {
                      method: 'PUT',
                      headers: { ...headers, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        provider: platformSmsForm.provider,
                        api_url: platformSmsForm.api_url,
                        sender_id: platformSmsForm.sender_id,
                        sender_id_type: platformSmsForm.sender_id_type,
                        sender_approval_status: platformSmsForm.sender_approval_status,
                        default_country_code: platformSmsForm.default_country_code,
                        config_json: {
                          api_key: '********',
                          api_key_header_name: platformSmsForm.api_key_header_name,
                          bearer_token: '********',
                          callback_url: platformSmsForm.callback_url,
                          client_id: '********',
                          password: '********',
                          service_id: platformSmsForm.service_id,
                          username: '********'
                        }
                      })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setPlatformSms(data);
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}>
                  <option value="not_configured">Not Configured</option>
                  <option value="verified">Verified</option>
                  <option value="active">Active</option>
                  <option value="test_failed">Failed</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Provider Credentials and Required Details</label>
              {platformSmsCredentialsMasked ? (
                <div className="flex-row" style={{ gap: '8px' }}>
                  <input className="form-control" value="Credentials stored securely" readOnly />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlatformSmsCredentialsMasked(false)}>Update Credentials</button>
                </div>
              ) : (
                <div className="grid-2">
                  {selectedSmsConfigFields.map(field => {
                    const required = Boolean(
                      selectedSmsProviderProfile?.required_credentials?.includes(field)
                      || selectedSmsProviderProfile?.required_static_fields?.includes(field)
                    );
                    const sensitive = SMS_SENSITIVE_FIELDS.has(field);
                    return (
                      <div className="form-group" style={{ marginBottom: 0 }} key={field}>
                        <label className="form-label" style={{ fontSize: '11px' }}>{smsFieldLabel(field)}{required ? '' : ' (Optional)'}</label>
                        <input
                          type={sensitive ? 'password' : 'text'}
                          className="form-control"
                          value={platformSmsForm[field] || ''}
                          onChange={e => setPlatformSmsForm(prev => ({ ...prev, [field]: e.target.value }))}
                          required={required}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-gap" style={{ marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>Save Platform SMS Settings</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handlePlatformSmsTest} disabled={loading || !platformSms.has_credentials}>Send Test SMS</button>
            </div>
            </form>
          </details>

          <div className="super-admin-sms-usage" style={{ marginTop: '18px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>Landlord SMS Usage This Month</h4>
            <div className="super-admin-sms-usage-table" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px' }}>Landlord / organization</th>
                    <th style={{ padding: '8px' }}>Sent</th>
                    <th style={{ padding: '8px' }}>Failed</th>
                    <th style={{ padding: '8px' }}>Blocked</th>
                    <th style={{ padding: '8px' }}>Provider cost</th>
                    <th style={{ padding: '8px' }}>Billed revenue</th>
                    <th style={{ padding: '8px' }}>Margin</th>
                    <th style={{ padding: '8px' }}>Sender ID</th>
                    <th style={{ padding: '8px' }}>Approval</th>
                    <th style={{ padding: '8px' }}>Last status</th>
                    <th style={{ padding: '8px' }}>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {smsLandlordRows.length === 0 ? (
                    <tr>
                      <td colSpan="11" style={{ padding: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>No SMS usage recorded this month.</td>
                    </tr>
                  ) : (
                    smsLandlordRows.map(row => (
                      <tr key={row.organization_id || 'platform'} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px', fontWeight: 700 }}>{row.organization_name || 'Platform / Unassigned'}</td>
                        <td style={{ padding: '8px' }}>{toFiniteNumber(row.sent_month)}</td>
                        <td style={{ padding: '8px' }}>{toFiniteNumber(row.failed_month)}</td>
                        <td style={{ padding: '8px' }}>{toFiniteNumber(row.blocked_month)}</td>
                        <td style={{ padding: '8px' }}>{formatMoney(row.provider_cost_month, smsCurrency)}</td>
                        <td style={{ padding: '8px' }}>{formatMoney(row.billed_revenue_month, smsCurrency)}</td>
                        <td style={{ padding: '8px' }}>{formatMoney(row.margin_month, smsCurrency)}</td>
                        <td style={{ padding: '8px' }}>{row.sender_id || '-'}</td>
                        <td style={{ padding: '8px' }}>{row.sender_approval_status || '-'}</td>
                        <td style={{ padding: '8px' }}>{row.last_sms_status || '-'}</td>
                        <td style={{ padding: '8px', maxWidth: '220px', whiteSpace: 'normal' }}>{row.last_error || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="super-admin-sms-usage-cards">
              {smsLandlordRows.length === 0 ? (
                <div className="sl-empty-state">
                  <div className="sl-empty-state-title">No SMS usage recorded this month.</div>
                </div>
              ) : (
                smsLandlordRows.map(row => (
                  <article key={row.organization_id || 'platform-card'} className="super-admin-sms-usage-card">
                    <div className="super-admin-sms-usage-card-head">
                      <strong>{row.organization_name || 'Platform / Unassigned'}</strong>
                      <span className={`badge ${row.last_sms_status === 'sent' || row.last_sms_status === 'delivered' ? 'badge-success' : row.last_sms_status === 'failed' ? 'badge-danger' : row.last_sms_status === 'blocked' ? 'badge-warning' : 'badge-secondary'}`}>
                        {row.last_sms_status || 'No status'}
                      </span>
                    </div>
                    <div className="super-admin-sms-count-strip">
                      <span><strong>{toFiniteNumber(row.sent_month)}</strong> Sent</span>
                      <span><strong>{toFiniteNumber(row.failed_month)}</strong> Failed</span>
                      <span><strong>{toFiniteNumber(row.blocked_month)}</strong> Blocked</span>
                    </div>
                    <div className="super-admin-sms-usage-card-grid">
                      <div>
                        <span>Provider Cost</span>
                        <strong>{formatMoney(row.provider_cost_month, smsCurrency)}</strong>
                      </div>
                      <div>
                        <span>Billed Revenue</span>
                        <strong>{formatMoney(row.billed_revenue_month, smsCurrency)}</strong>
                      </div>
                      <div>
                        <span>Margin</span>
                        <strong>{formatMoney(row.margin_month, smsCurrency)}</strong>
                      </div>
                      <div>
                        <span>Sender / Approval</span>
                        <strong>{row.sender_id || '-'} / {row.sender_approval_status || '-'}</strong>
                      </div>
                    </div>
                    <div className="super-admin-sms-last-error">
                      <span>Last Error</span>
                      <strong>{row.last_error || '-'}</strong>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )
    }

      {/* SYSTEM ERRORS */}
      {activeTab === 'errors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {safeSystemErrors.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-title">System Logs Clean</div>
              <div className="sl-empty-state-desc">No system errors have been logged.</div>
            </div>
          ) : (
            safeSystemErrors.map(err => (
              <div key={err.id} className="sl-list-card" style={{ borderLeft: '4px solid var(--danger)' }}>
                <div className="flex-row">
                  <strong style={{ color: 'var(--danger)', fontSize: '11px' }}>{err.source.toUpperCase()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(err.created_at).toLocaleDateString()}</span>
                </div>
                <p style={{ fontSize: '13px', marginTop: '6px', fontWeight: '600' }}>{err.message}</p>
                {err.stack_trace && <pre style={{ fontSize: '10px', color: 'var(--text-muted)', overflowX: 'auto', background: 'var(--bg-base)', padding: '6px', borderRadius: '4px', marginTop: '6px' }}>{err.stack_trace}</pre>}
              </div>
            ))
          )}
        </div>
      )}

      {/* SYSTEM AUDITS */}
      {activeTab === 'audits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {safeSystemAudits.map(log => (
            <div key={log.id} className="sl-list-card" style={{ fontSize: '12px' }}>
              <div className="flex-row">
                <strong style={{ textTransform: 'uppercase', color: 'var(--primary)', fontSize: '11px' }}>{log.action.replace(/_/g, ' ')}</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: '6px' }}>
                Admin User: <strong>Super Admin</strong>
              </div>
              {log.org_name && <div>Target: <strong>{log.org_name}</strong></div>}
              {log.reason && <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px' }}>Reason: {log.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {/* COMPLIANCE & DELETION REQUESTS */}
      {activeTab === 'compliance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {safeDeletionRequests.length === 0 ? (
            <div className="sl-empty-state">
              <div className="sl-empty-state-title">No requests found</div>
              <div className="sl-empty-state-desc">No compliance or deletion requests found.</div>
            </div>
          ) : (
            safeDeletionRequests.map(req => (
              <div key={req.id} className="sl-list-card">
                <div className="flex-row">
                  <span className="badge badge-info" style={{ textTransform: 'uppercase' }}>
                    {req.request_type.replace(/_/g, ' ')}
                  </span>
                  <span className={`badge ${
                    req.status === 'completed' ? 'badge-success' :
                    req.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                  }`}>
                    {req.status}
                  </span>
                </div>
                
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>{req.org_name}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Requested by: <strong>{req.requester_name}</strong> (User ID: {req.requested_by})
                </p>
                
                <div style={{ background: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '4px', fontSize: '12px', margin: '8px 0' }}>
                  <div><strong>Reason:</strong> {req.reason}</div>
                  {req.target_tenant_id && <div><strong>Target Tenant ID:</strong> {req.target_tenant_id}</div>}
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Date: {new Date(req.created_at).toLocaleString()}
                  </div>
                </div>

                {req.status === 'requested' && (
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleProcessDeletion(req.id, 'reject')}
                      disabled={loading}
                    >
                      Reject
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleProcessDeletion(req.id, 'approve')}
                      disabled={loading}
                    >
                      Approve & Anonymize
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

          </div>
        </main>

        {/* Mobile Sheet / Drawer Menu */}
        {isDrawerOpen && (
          <div className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
              <div className="drawer-header">
                <div className="drawer-handle" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Manage Sections</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Switch between control panels</p>
              </div>
              <nav className="drawer-nav" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                {SUPER_ADMIN_TABS.map(tab => {
                  const Icon = getTabIcon(tab.id);
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`drawer-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setIsDrawerOpen(false);
                      }}
                    >
                      <Icon size={18} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '16px', width: '100%', padding: '10px' }}
                onClick={() => setIsDrawerOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

