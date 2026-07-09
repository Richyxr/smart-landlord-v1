import React, { useState, useEffect } from 'react';
import Auth from './pages/Auth.jsx';
import CompleteProfile from './pages/CompleteProfile.jsx';
import LandlordDashboard from './pages/LandlordDashboard.jsx';
import Properties from './pages/Properties.jsx';
import Invoices from './pages/Invoices.jsx';
import Reconciliation from './pages/Reconciliation.jsx';
import PaymentEvidence from './pages/PaymentEvidence.jsx';
import Stats from './pages/Stats.jsx';
import Settings from './pages/Settings.jsx';
import Caretaker from './pages/Caretaker.jsx';
import SuperAdmin from './pages/SuperAdmin.jsx';
import SaaSInvoices from './pages/SaaSInvoices.jsx';
import { Toaster, toast } from 'sonner';

import BottomNav from './components/BottomNav.jsx';
import DesktopSidebar from './components/DesktopSidebar.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import ThemeModeToggle from './components/ThemeModeToggle.jsx';
import ImpersonationBanner from './components/ImpersonationBanner.jsx';
import DevSwitcher from './components/DevSwitcher.jsx';
import { clearSessionToken, getSessionToken, setSessionToken } from './lib/session.js';
import { auth } from './lib/firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const demoMode =
  import.meta.env.VITE_DEMO_MODE === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false');

const NAVIGATION_STORAGE_KEY = 'smart_landlord_last_navigation_v1';
const IMPERSONATION_NAVIGATION_STORAGE_KEY = 'smart_landlord_impersonation_navigation_v1';

const VALID_TABS_BY_ROLE = {
  landlord: new Set([
    'landlord_dashboard',
    'landlord_properties',
    'landlord_invoices',
    'landlord_reconciliation',
    'landlord_payment_evidence',
    'landlord_subscription',
    'landlord_stats',
    'landlord_settings'
  ]),
  super_admin: new Set([
    'admin_dashboard',
    'admin_orgs',
    'admin_pricing',
    'admin_billing',
    'admin_email',
    'admin_sms',
    'admin_errors',
    'admin_audits',
    'admin_compliance'
  ]),
  caretaker: new Set([
    'caretaker_dashboard',
    'caretaker_readings',
    'caretaker_messages',
    'caretaker_profile'
  ])
};

const VALID_PROPERTY_SUBTABS = new Set(['properties', 'units', 'tenants', 'caretakers', 'staff']);
const VALID_INVOICE_SUBTABS = new Set(['overview', 'due_tenants', 'invoices', 'payments', 'banking', 'utilities']);
const VALID_SETTINGS_SUBTABS = new Set([
  'readiness',
  'integrations',
  'security_pin',
  'readings',
  'archive',
  'audits',
  'notifications',
  'compliance'
]);

const SUPER_ADMIN_LABEL_TO_TAB = {
  overview: 'admin_dashboard',
  landlords: 'admin_orgs',
  'confirm saas': 'admin_billing',
  email: 'admin_email',
  'sms gateway': 'admin_sms',
  errors: 'admin_errors',
  'system logs': 'admin_audits',
  compliance: 'admin_compliance'
};

const CARETAKER_LABEL_TO_TAB = {
  home: 'caretaker_dashboard',
  dashboard: 'caretaker_dashboard',
  readings: 'caretaker_readings',
  'new reading': 'caretaker_readings',
  messages: 'caretaker_messages',
  profile: 'caretaker_profile'
};

function sanitizeSavedNavigation(saved, currentRole) {
  if (!saved || saved.role !== currentRole) return null;

  const allowedTabs = VALID_TABS_BY_ROLE[currentRole];
  if (!allowedTabs || !allowedTabs.has(saved.activeTab)) return null;

  const next = {
    activeTab: saved.activeTab,
    propertiesSubTab: null,
    invoicesSubTab: null,
    settingsSubTab: null
  };

  if (currentRole === 'landlord') {
    if (VALID_PROPERTY_SUBTABS.has(saved.propertiesSubTab)) {
      next.propertiesSubTab = saved.propertiesSubTab === 'staff' ? 'caretakers' : saved.propertiesSubTab;
    }
    if (VALID_INVOICE_SUBTABS.has(saved.invoicesSubTab)) {
      next.invoicesSubTab = saved.invoicesSubTab;
    }
    if (VALID_SETTINGS_SUBTABS.has(saved.settingsSubTab)) {
      next.settingsSubTab = saved.settingsSubTab;
    }
  }

  return next;
}

function readSavedNavigation(currentRole) {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(NAVIGATION_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSavedNavigation(JSON.parse(raw), currentRole);
  } catch (error) {
    console.warn('Ignoring invalid saved navigation state.', error);
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('landlord'); // landlord, caretaker, super_admin
  const [organization, setOrganization] = useState(null);
  const [activeTab, setActiveTab] = useState('landlord_dashboard');
  const [propertiesSubTab, setPropertiesSubTab] = useState(null);
  const [settingsSubTab, setSettingsSubTab] = useState(null);
  const [invoicesSubTab, setInvoicesSubTab] = useState(null);
  const [authRestoring, setAuthRestoring] = useState(true);
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const [navigationRestored, setNavigationRestored] = useState(false);

  const handleNavigate = (page, subTab) => {
    let targetPage = page;
    let targetSubTab = subTab;
    if (page === 'landlord_reconciliation' || page === 'landlord_payment_evidence') {
      targetPage = 'landlord_invoices';
      targetSubTab = 'banking';
    }
    setActiveTab(targetPage);
    if (targetPage === 'landlord_properties' && targetSubTab) {
      setPropertiesSubTab(targetSubTab);
    }
    if (targetPage === 'landlord_settings' && targetSubTab) {
      setSettingsSubTab(targetSubTab);
    }
    if (targetPage === 'landlord_invoices' && targetSubTab) {
      setInvoicesSubTab(targetSubTab);
    }
  };

  const handleNavigationStateCapture = (event) => {
    if (!user) return;

    const clickable = event.target?.closest?.('button, a, [role="tab"]');
    if (!clickable) return;

    const label = String(clickable.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!label) return;

    if (role === 'super_admin') {
      const nextAdminTab = SUPER_ADMIN_LABEL_TO_TAB[label];
      if (nextAdminTab) {
        setActiveTab(nextAdminTab);
      }
      return;
    }

    if (role === 'caretaker') {
      const nextCaretakerTab = CARETAKER_LABEL_TO_TAB[label];
      if (nextCaretakerTab) {
        setActiveTab(nextCaretakerTab);
      }
      return;
    }

    if (role !== 'landlord') return;

    if (activeTab === 'landlord_properties') {
      const propertyTabMap = {
        properties: 'properties',
        units: 'units',
        tenants: 'tenants',
        staff: 'caretakers'
      };
      if (propertyTabMap[label]) {
        setPropertiesSubTab(propertyTabMap[label]);
      }
      return;
    }

    if (activeTab === 'landlord_invoices') {
      const invoiceTabMap = {
        overview: 'overview',
        invoices: 'invoices',
        payments: 'payments',
        banking: 'banking',
        utilities: 'utilities'
      };
      if (invoiceTabMap[label]) {
        setInvoicesSubTab(invoiceTabMap[label]);
      } else if (label.includes('open banking')) {
        setInvoicesSubTab('banking');
      } else if (label.includes('back to overview')) {
        setInvoicesSubTab('overview');
      }
      return;
    }

    if (activeTab === 'landlord_settings') {
      const settingsTabMap = {
        'setup checklist': 'readiness',
        integrations: 'integrations',
        'security pin': 'security_pin',
        'caretaker readings': 'readings',
        archive: 'archive',
        'audit logs': 'audits',
        notifications: 'notifications',
        compliance: 'compliance'
      };
      if (settingsTabMap[label]) {
        setSettingsSubTab(settingsTabMap[label]);
      }
    }
  };

  // Impersonation Support Session
  const [impersonationSession, setImpersonationSession] = useState(null); // { id, orgName }
  const [originalAdminUser, setOriginalAdminUser] = useState(null);
  const [originalAdminToken, setOriginalAdminToken] = useState(null);

  // Billing Lockout State
  const [isLocked, setIsLocked] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const resolveFirebaseSession = async (firebaseUser) => {
    const idToken = await firebaseUser.getIdToken();

    const res = await fetch('/api/auth/firebase-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({})
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to restore session.');
    }

    return data;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const hasPasswordResetToken = typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('token');
      if (hasPasswordResetToken) {
        clearSessionToken();
        setUser(null);
        setRole('landlord');
        setOrganization(null);
        setIsLocked(false);
        setAuthRestoring(false);
        return;
      }

      if (!firebaseUser) {
        clearSessionToken();
        setUser(null);
        setRole('landlord');
        setOrganization(null);
        setIsLocked(false);
        setAuthRestoring(false);
        return;
      }

      try {
        const data = await resolveFirebaseSession(firebaseUser);
        handleAuthSuccess(data.user, data.role, data.organization, data.auth_token);
      } catch (error) {
        console.error('Failed to restore Firebase session.', error);
        clearSessionToken();
        setUser(null);
        setRole('landlord');
        setOrganization(null);
        setIsLocked(false);
      } finally {
        setAuthRestoring(false);
      }
    });

    return unsubscribe;
  }, []);

  const statusTexts = [
    'Verifying your session',
    'Loading your dashboard',
    'Preparing your workspace',
    'Almost ready'
  ];

  useEffect(() => {
    if (authRestoring) {
      const interval = setInterval(() => {
        setLoadingStatusIndex(prev => (prev + 1) % statusTexts.length);
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [authRestoring]);

  useEffect(() => {
    window.notifySuccess = (title, description) => {
      toast.success(title, { description });
    };
    window.notifyError = (title, description) => {
      toast.error(title, { description });
    };
    window.notifyWarning = (title, description) => {
      toast.warning(title, { description });
    };
    window.notifyInfo = (title, description) => {
      toast.info(title, { description });
    };
    window.showConfirm = (title, message, onConfirm, onCancel, confirmText, cancelText, hideCancel = false) => {
      setConfirmState({ title, message, onConfirm, onCancel, confirmText, cancelText, hideCancel });
    };
    window.showPrompt = (title, placeholder, defaultValue, onSubmit, onCancel) => {
      setPromptState({ title, placeholder, defaultValue, onSubmit, onCancel });
    };

    return () => {
      delete window.notifySuccess;
      delete window.notifyError;
      delete window.notifyWarning;
      delete window.notifyInfo;
      delete window.showConfirm;
      delete window.showPrompt;
    };
  }, []);

  // Load a demo session only for local/demo builds.
  useEffect(() => {
    const hasPasswordResetToken = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('token');
    if (demoMode && !auth.currentUser && !hasPasswordResetToken) {
      autoLoginDemo();
    }
  }, []);

  const autoLoginDemo = async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'landlord@demo.com', role: 'landlord' })
      });
      const data = await res.json();
      if (res.ok) {
        handleAuthSuccess(data.user, data.role, data.organization, data.auth_token);
      }
    } catch (e) {
      console.error('Auto login failed, displaying auth welcome.', e);
    }
  };

  const handleAuthSuccess = (authUser, authRole, authOrg, authToken) => {
    setNavigationRestored(false);
    setSessionToken(authToken);
    setUser(authUser);
    setRole(authRole);
    setOrganization(authOrg);
    setIsLocked(authOrg?.is_locked || false);

    // Set appropriate start tabs
    if (authRole === 'super_admin') {
      setActiveTab('admin_dashboard');
    } else if (authRole === 'caretaker') {
      setActiveTab('caretaker_dashboard');
    } else {
      setActiveTab('landlord_dashboard');
    }
  };

  useEffect(() => {
    if (authRestoring) return;

    if (!user) {
      setNavigationRestored(false);
      return;
    }

    if (navigationRestored) return;

    // Check for a saved impersonation session BEFORE any role-based restore.
    //
    // Why unconditional: in demo/dev mode, Firebase has no session for the super
    // admin (DevSwitcher uses /api/auth/login). On refresh, autoLoginDemo() always
    // resolves to role='landlord', so a guard of `role === 'super_admin'` is never
    // reached. By checking here — regardless of the current role — we correctly
    // restore the impersonation even when the surrounding auth context came back
    // as a plain landlord or super_admin.
    //
    // originalAdminUser / originalAdminToken are read from the saved payload (not
    // from transient React state) so the correct admin identity is always restored.
    try {
      const raw = window.localStorage.getItem(IMPERSONATION_NAVIGATION_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved?.impersonating &&
          saved?.impersonatedAuthToken &&
          saved?.impersonatedUser &&
          saved?.impersonatedOrg &&
          saved?.originalAdminUser &&
          saved?.originalAdminToken
        ) {
          // Restore admin identity from the payload — works in both Firebase and
          // demo mode because we don't rely on the current `user` state here.
          setOriginalAdminUser(saved.originalAdminUser);
          setOriginalAdminToken(saved.originalAdminToken);
          // Switch session to the impersonated landlord's token.
          setSessionToken(saved.impersonatedAuthToken);
          setImpersonationSession({
            id: saved.impersonationSessionId,
            orgName: saved.impersonationSessionOrgName,
            orgId: saved.impersonationSessionOrgId
          });
          setUser(saved.impersonatedUser);
          setRole('landlord');
          setOrganization(saved.impersonatedOrg);
          setIsLocked(saved.impersonatedOrg.is_locked || false);
          // Restore the landlord's last active tab/sub-tabs.
          if (VALID_TABS_BY_ROLE.landlord.has(saved.activeTab)) {
            setActiveTab(saved.activeTab);
            if (VALID_PROPERTY_SUBTABS.has(saved.propertiesSubTab)) {
              setPropertiesSubTab(saved.propertiesSubTab);
            }
            if (VALID_INVOICE_SUBTABS.has(saved.invoicesSubTab)) {
              setInvoicesSubTab(saved.invoicesSubTab);
            }
            if (VALID_SETTINGS_SUBTABS.has(saved.settingsSubTab)) {
              setSettingsSubTab(saved.settingsSubTab);
            }
          }
          setNavigationRestored(true);
          return;
        }
      }
    } catch (e) {
      console.warn('Ignoring invalid saved impersonation state.', e);
      window.localStorage.removeItem(IMPERSONATION_NAVIGATION_STORAGE_KEY);
    }

    // Normal (non-impersonation) navigation restore.
    if (role === 'landlord' && organization && !organization.profile_completed) {
      setNavigationRestored(true);
      return;
    }

    const savedNavigation = readSavedNavigation(role);
    if (savedNavigation) {
      setActiveTab(savedNavigation.activeTab);
      setPropertiesSubTab(savedNavigation.propertiesSubTab);
      setInvoicesSubTab(savedNavigation.invoicesSubTab);
      setSettingsSubTab(savedNavigation.settingsSubTab);
    }

    setNavigationRestored(true);
  }, [authRestoring, navigationRestored, organization, user, role]);

  useEffect(() => {
    if (!user || authRestoring || !navigationRestored) return;
    if (role === 'landlord' && organization && !organization.profile_completed) return;

    // During impersonation: write nav state to the impersonation key only.
    // This prevents overwriting the real Super Admin's saved navigation.
    if (impersonationSession) {
      if (role !== 'landlord') return;
      if (!VALID_TABS_BY_ROLE.landlord.has(activeTab)) return;
      try {
        const raw = window.localStorage.getItem(IMPERSONATION_NAVIGATION_STORAGE_KEY);
        const existing = raw ? JSON.parse(raw) : {};
        window.localStorage.setItem(
          IMPERSONATION_NAVIGATION_STORAGE_KEY,
          JSON.stringify({
            ...existing,
            activeTab,
            propertiesSubTab: VALID_PROPERTY_SUBTABS.has(propertiesSubTab) ? propertiesSubTab : null,
            invoicesSubTab: VALID_INVOICE_SUBTABS.has(invoicesSubTab) ? invoicesSubTab : null,
            settingsSubTab: VALID_SETTINGS_SUBTABS.has(settingsSubTab) ? settingsSubTab : null,
            savedAt: Date.now()
          })
        );
      } catch (e) {
        console.warn('Unable to save impersonation navigation state.', e);
      }
      return; // Never fall through to the normal key while impersonating.
    }

    const allowedTabs = VALID_TABS_BY_ROLE[role];
    if (!allowedTabs?.has(activeTab)) return;

    const payload = {
      role,
      activeTab,
      propertiesSubTab: VALID_PROPERTY_SUBTABS.has(propertiesSubTab) ? propertiesSubTab : null,
      invoicesSubTab: VALID_INVOICE_SUBTABS.has(invoicesSubTab) ? invoicesSubTab : null,
      settingsSubTab: VALID_SETTINGS_SUBTABS.has(settingsSubTab) ? settingsSubTab : null,
      savedAt: Date.now()
    };

    try {
      window.localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to save navigation state.', error);
    }
  }, [
    activeTab,
    authRestoring,
    impersonationSession,
    invoicesSubTab,
    navigationRestored,
    organization,
    propertiesSubTab,
    role,
    settingsSubTab,
    user
  ]);

  const handleLogout = async () => {
    await signOut(auth);
    clearSessionToken();
    try { window.localStorage.removeItem(IMPERSONATION_NAVIGATION_STORAGE_KEY); } catch (_) {}
    setUser(null);
    setRole('landlord');
    setOrganization(null);
    setIsLocked(false);
    setImpersonationSession(null);
    setOriginalAdminUser(null);
    setOriginalAdminToken(null);
    setActiveTab('landlord_dashboard');
    setNavigationRestored(false);
  };

  // DevSwitcher role change simulator
  const handleRoleChange = async (targetRole) => {
    // If exiting impersonation via switcher
    if (impersonationSession) {
      await handleExitImpersonation();
    }

    try {
      let email = 'landlord@demo.com';
      if (targetRole === 'caretaker') email = 'caretaker@demo.com';
      if (targetRole === 'super_admin') email = 'admin@smartlandlord.com';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: targetRole })
      });
      const data = await res.json();
      if (res.ok) {
        handleAuthSuccess(data.user, data.role, data.organization, data.auth_token);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Impersonation Controls
  const handleImpersonateStart = (session, targetOrg, targetOwner, authToken) => {
    // Capture admin identity BEFORE switching the session token.
    const adminUser = user;
    const adminToken = getSessionToken();

    // Persist the full impersonation session to localStorage so a page refresh
    // can reconstruct it without any server round-trip beyond Firebase auth.
    // originalAdminUser / originalAdminToken are stored here so the restore
    // works in BOTH Firebase-auth mode AND demo mode (where autoLoginDemo
    // overwrites user/role to a plain landlord before the restore effect runs).
    try {
      window.localStorage.setItem(
        IMPERSONATION_NAVIGATION_STORAGE_KEY,
        JSON.stringify({
          role: 'landlord',
          impersonating: true,
          impersonationSessionId: session.id,
          impersonationSessionOrgName: targetOrg.name,
          impersonationSessionOrgId: targetOrg.id,
          impersonatedAuthToken: authToken,
          impersonatedUser: targetOwner,
          impersonatedOrg: targetOrg,
          originalAdminUser: adminUser,
          originalAdminToken: adminToken,
          activeTab: 'landlord_dashboard',
          propertiesSubTab: null,
          invoicesSubTab: null,
          settingsSubTab: null,
          savedAt: Date.now()
        })
      );
    } catch (e) {
      console.warn('Unable to persist impersonation session for refresh recovery.', e);
    }
    setOriginalAdminUser(adminUser);
    setOriginalAdminToken(adminToken);
    setSessionToken(authToken);
    setImpersonationSession({
      id: session.id,
      orgName: targetOrg.name,
      orgId: targetOrg.id
    });
    setUser(targetOwner);
    setRole('landlord'); // Switch to landlord context
    setOrganization(targetOrg);
    setIsLocked(targetOrg.is_locked);
    setActiveTab('landlord_dashboard');
  };

  const handleExitImpersonation = async () => {
    if (!impersonationSession) return;
    try {
      await fetch('/api/admin/impersonate/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${originalAdminToken || getSessionToken()}`
        },
        body: JSON.stringify({ session_id: impersonationSession.id })
      });

      // Clear impersonation persistence before restoring admin state.
      try { window.localStorage.removeItem(IMPERSONATION_NAVIGATION_STORAGE_KEY); } catch (_) {}

      setUser(originalAdminUser);
      setSessionToken(originalAdminToken);
      setRole('super_admin');
      setOrganization(null);
      setIsLocked(false);
      setImpersonationSession(null);
      setOriginalAdminUser(null);
      setOriginalAdminToken(null);
      // Restore the super admin's own last-visited page, falling back to dashboard.
      const savedAdminNav = readSavedNavigation('super_admin');
      setActiveTab(savedAdminNav?.activeTab || 'admin_dashboard');
      triggerRefresh();
    } catch (e) {
      console.error('Failed to end impersonation', e);
    }
  };

  const triggerRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    if (activeTab === 'landlord_reconciliation' || activeTab === 'landlord_payment_evidence') {
      setInvoicesSubTab('banking');
      setActiveTab('landlord_invoices');
    }
  }, [activeTab]);

  const handleMockUnlock = () => {
    setIsLocked(false);
    triggerRefresh();
  };

  const handleUpdateOrganization = (updatedOrg) => {
    setOrganization(updatedOrg);
  };

  if (authRestoring) {
    return (
      <div className="session-restore-screen">
        <div className="session-restore-card">
          <div className="session-restore-orb-container">
            <div className="session-restore-orb">
              <img src="/icons/maskable-192.png" alt="Smart Landlord" className="session-restore-logo" />
            </div>
          </div>
          <h2 className="session-restore-title">Securing your workspace</h2>
          <p className="session-restore-subtitle">Checking your access and preparing Smart Landlord.</p>

          <div className="session-restore-progress-container">
            <div className="session-restore-progress-bar" />
          </div>

          <div className="session-restore-status">
            <span>{statusTexts[loadingStatusIndex]}</span>
          </div>

          <div className="session-restore-skeleton">
            <div className="skeleton-line" />
          </div>

          <div className="session-restore-footer">
            <span className="session-restore-brand-text">
              <span className="session-restore-brand-smart">Smart</span>
              <span className="session-restore-brand-landlord">Landlord</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Routing render logic based on activeTab
  const renderActivePage = () => {
    // Check lockout first (Landlord context only)
    if (isLocked && role === 'landlord') {
      return (
        <SaaSInvoices
          organization={organization}
          refreshTrigger={refreshTrigger}
          onRefresh={handleMockUnlock}
          forceShowLock={true}
        />
      );
    }

    switch (activeTab) {
      // Landlord Pages
      case 'landlord_dashboard':
        return <LandlordDashboard organization={organization} onNavigate={handleNavigate} refreshTrigger={refreshTrigger} />;
      case 'landlord_properties':
        return (
          <Properties
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            initialSubTab={propertiesSubTab}
            clearInitialSubTab={() => {}}
          />
        );
      case 'landlord_invoices':
        return (
          <Invoices
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            initialSubTab={invoicesSubTab}
            clearInitialSubTab={() => {}}
            onNavigate={handleNavigate}
            user={user}
            role={role}
          />
        );
      case 'landlord_reconciliation':
      case 'landlord_payment_evidence':
        return (
          <Invoices
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            initialSubTab="banking"
            clearInitialSubTab={() => {}}
            onNavigate={handleNavigate}
            user={user}
            role={role}
          />
        );
      case 'landlord_subscription':
        return (
          <SaaSInvoices
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            forceShowLock={false}
          />
        );
      case 'landlord_stats':
        return <Stats />;
      case 'landlord_settings':
        return (
          <Settings
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            initialSubTab={settingsSubTab}
            clearInitialSubTab={() => {}}
            onNavigate={handleNavigate}
            onUpdateOrganization={handleUpdateOrganization}
            role={role}
          />
        );

      // Caretaker Pages
      case 'caretaker_dashboard':
      case 'caretaker_readings':
      case 'caretaker_messages':
      case 'caretaker_profile':
        return <Caretaker user={user} activeRoute={activeTab} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

      // Super Admin Pages
      case 'admin_dashboard':
      case 'admin_orgs':
      case 'admin_pricing':
      case 'admin_billing':
      case 'admin_email':
      case 'admin_sms':
      case 'admin_errors':
      case 'admin_audits':
      case 'admin_compliance':
        return <SuperAdmin activeRoute={activeTab} onImpersonateStart={handleImpersonateStart} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

      default:
        return <div>Tab not found.</div>;
    }
  };

  return (
    <div
      onClickCapture={handleNavigationStateCapture}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}
    >
      {/* Impersonation Warning Header */}
      {impersonationSession && (
        <ImpersonationBanner session={impersonationSession} onExit={handleExitImpersonation} />
      )}

      {/* Welcome & Authentication */}
      {!user ? (
        <Auth onAuthSuccess={handleAuthSuccess} />
      ) : role === 'landlord' && organization && !organization.profile_completed ? (
        <CompleteProfile
          user={user}
          organization={organization}
          onComplete={handleAuthSuccess}
        />
      ) : (
        <div className="responsive-app-shell">
          {(!isLocked || role !== 'landlord') && (
            <DesktopSidebar
              role={role}
              activeTab={activeTab}
              onChangeTab={setActiveTab}
            />
          )}

          <div className="responsive-main-shell">
            {/* Main App Layout Header */}
            <div className="app-header">
              <div className="app-brand">
                <img src="/icons/maskable-192.png" alt="Smart Landlord" className="app-brand-logo" />
                <span className="header-brand-text">
                  <span className="header-brand-smart">Smart</span>
                  <span className="header-brand-landlord">Landlord</span>
                </span>
              </div>
              <div className="app-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-info app-role-badge" style={{ textTransform: 'uppercase', fontSize: '9px' }}>
                  {role.replace('_', ' ')}
                </span>
                <ThemeModeToggle />
                <button
                  className="btn btn-secondary btn-sm app-logout-button"
                  onClick={handleLogout}
                  style={{ padding: '4px 8px', fontSize: '10px' }}
                >
                  Logout
                </button>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="app-content">
              {renderActivePage()}
            </div>

            {/* Role Aware Bottom Navigation */}
            {(!isLocked || role !== 'landlord') && (
              <BottomNav role={role} activeTab={activeTab} onChangeTab={setActiveTab} />
            )}

            {demoMode && (
              <DevSwitcher
                currentRole={role}
                onChangeRole={handleRoleChange}
                currentOrgId={organization ? organization.id : 1}
                onTriggerLockout={() => setIsLocked(true)}
                onRefreshData={triggerRefresh}
              />
            )}
          </div>
        </div>
      )}
      <InstallPrompt />

      {/* Centralized Branded Alert Dialog */}
      {confirmState && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '380px', padding: '20px' }}>
            <h3 className="card-title" style={{ fontSize: '15px', fontWeight: '800', marginBottom: '8px', borderBottom: 'none', paddingBottom: 0 }}>
              {confirmState.title}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
              {confirmState.message}
            </p>
            <div className="flex-gap" style={{ justifyContent: 'flex-end', gap: '8px' }}>
              {!confirmState.hideCancel && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (confirmState.onCancel) confirmState.onCancel();
                    setConfirmState(null);
                  }}
                  style={{ minWidth: '70px' }}
                >
                  {confirmState.cancelText || 'Cancel'}
                </button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (confirmState.onConfirm) confirmState.onConfirm();
                  setConfirmState(null);
                }}
                style={{ minWidth: '70px' }}
              >
                {confirmState.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centralized Branded Prompt Modal */}
      {promptState && (
        <PromptModalStateWrapper promptState={promptState} onClose={() => setPromptState(null)} />
      )}

      {/* Branded Toaster */}
      <Toaster
        theme="dark"
        position="top-right"
        closeButton
        toastOptions={{
          className: 'sl-toast',
          success: { className: 'sl-toast-success' },
          error: { className: 'sl-toast-error' },
          warning: { className: 'sl-toast-warning' }
        }}
      />
    </div>
  );
}

function PromptModalStateWrapper({ promptState, onClose }) {
  const [val, setVal] = useState(promptState.defaultValue || '');
  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '380px', padding: '20px' }}>
        <h3 className="card-title" style={{ fontSize: '15px', fontWeight: '800', marginBottom: '12px', borderBottom: 'none', paddingBottom: 0 }}>
          {promptState.title}
        </h3>
        <div className="form-group" style={{ marginBottom: '20px' }}>
          <input
            type="text"
            className="form-control"
            placeholder={promptState.placeholder}
            value={val}
            onChange={e => setVal(e.target.value)}
            autoFocus
            style={{ width: '100%' }}
          />
        </div>
        <div className="flex-gap" style={{ justifyContent: 'flex-end', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (promptState.onCancel) promptState.onCancel();
              onClose();
            }}
            style={{ minWidth: '70px' }}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (promptState.onSubmit) promptState.onSubmit(val);
              onClose();
            }}
            style={{ minWidth: '70px' }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}














