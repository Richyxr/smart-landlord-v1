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

const getTabFromUrl = () => {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get('tab');
  
  if (['/', '/login', '/register', '/forgot-password', '/reset-password', '/reset-pin', '/verify-email', '/complete-profile'].includes(path)) {
    return null;
  }

  // Caretaker views
  if (path === '/caretaker') {
    return { active: 'caretaker_dashboard', sub: null };
  }
  if (path.startsWith('/caretaker/')) {
    const sub = path.replace('/caretaker/', '');
    if (sub === 'readings') return { active: 'caretaker_readings', sub: null };
    if (sub === 'messages') return { active: 'caretaker_messages', sub: null };
    if (sub === 'profile') return { active: 'caretaker_profile', sub: null };
  }

  // Admin views
  if (path === '/admin') {
    return { active: 'admin_dashboard', sub: null };
  }
  if (path.startsWith('/admin/')) {
    const sub = path.replace('/admin/', '');
    if (sub === 'landlords') return { active: 'admin_orgs', sub: null };
    if (sub === 'billing') return { active: 'admin_pricing', sub: null };
    if (sub === 'email') return { active: 'admin_email', sub: null };
    if (sub === 'sms') return { active: 'admin_sms', sub: null };
    if (sub === 'errors') return { active: 'admin_errors', sub: null };
    if (sub === 'audits') return { active: 'admin_audits', sub: null };
    if (sub === 'compliance') return { active: 'admin_compliance', sub: null };
  }

  // Landlord views
  if (path === '/home') {
    return { active: 'landlord_dashboard', sub: null };
  }
  if (path === '/properties') {
    return { active: 'landlord_properties', sub: tab || 'properties' };
  }
  if (path === '/billing') {
    return { active: 'landlord_invoices', sub: tab || 'overview' };
  }
  if (path === '/stats') {
    return { active: 'landlord_stats', sub: null };
  }
  if (path === '/subscription') {
    return { active: 'landlord_subscription', sub: null };
  }
  if (path === '/settings') {
    return { active: 'landlord_settings', sub: tab || 'readiness' };
  }

  return null;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('landlord'); // landlord, caretaker, super_admin
  const [organization, setOrganization] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const route = getTabFromUrl();
    return route ? route.active : 'landlord_dashboard';
  });
  const [propertiesSubTab, setPropertiesSubTab] = useState(() => {
    const route = getTabFromUrl();
    return (route && route.active === 'landlord_properties') ? route.sub : null;
  });
  const [settingsSubTab, setSettingsSubTab] = useState(() => {
    const route = getTabFromUrl();
    return (route && route.active === 'landlord_settings') ? route.sub : null;
  });
  const [invoicesSubTab, setInvoicesSubTab] = useState(() => {
    const route = getTabFromUrl();
    return (route && route.active === 'landlord_invoices') ? route.sub : null;
  });
  const [authRestoring, setAuthRestoring] = useState(true);
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);

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
    setSessionToken(authToken);
    setUser(authUser);
    setRole(authRole);
    setOrganization(authOrg);
    setIsLocked(authOrg?.is_locked || false);

    // Set appropriate start tabs
    if (authRole === 'super_admin') {
      const searchParams = new URLSearchParams(window.location.search);
      const impOrgId = searchParams.get('impersonateOrgId');
      if (impOrgId) {
        // Automatically restore impersonation
        fetch('/api/admin/impersonate/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ organization_id: Number(impOrgId), reason: 'Restored impersonation session from URL refresh' })
        })
          .then(res => {
            if (res.ok) return res.json();
            throw new Error('Failed to start impersonation');
          })
          .then(data => {
            handleImpersonateStart(data.session, data.targetOrg, data.ownerUser, data.auth_token);
          })
          .catch(err => {
            console.error('Failed to auto-restore impersonation:', err);
            setActiveTab('admin_dashboard');
          });
      } else {
        setActiveTab('admin_dashboard');
      }
    } else if (authRole === 'caretaker') {
      setActiveTab('caretaker_dashboard');
    } else {
      const route = getTabFromUrl();
      if (route) {
        setActiveTab(route.active);
        if (route.active === 'landlord_properties') setPropertiesSubTab(route.sub);
        if (route.active === 'landlord_invoices') setInvoicesSubTab(route.sub);
        if (route.active === 'landlord_settings') setSettingsSubTab(route.sub);
      } else {
        setActiveTab('landlord_dashboard');
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    clearSessionToken();
    setUser(null);
    setRole('landlord');
    setOrganization(null);
    setIsLocked(false);
    setImpersonationSession(null);
    setOriginalAdminUser(null);
    setOriginalAdminToken(null);
    setActiveTab('landlord_dashboard');
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
    setOriginalAdminUser(user);
    setOriginalAdminToken(getSessionToken());
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

      setUser(originalAdminUser);
      setSessionToken(originalAdminToken);
      setRole('super_admin');
      setOrganization(null);
      setIsLocked(false);
      setImpersonationSession(null);
      setOriginalAdminUser(null);
      setOriginalAdminToken(null);
      setActiveTab('admin_dashboard');
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

  const syncStateFromUrl = () => {
    const route = getTabFromUrl();
    if (!route) return;
    
    if (route.active !== activeTab) {
      setActiveTab(route.active);
    }
    
    if (route.active === 'landlord_properties') {
      setPropertiesSubTab(route.sub);
    } else if (route.active === 'landlord_invoices') {
      setInvoicesSubTab(route.sub);
    } else if (route.active === 'landlord_settings') {
      setSettingsSubTab(route.sub);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      syncStateFromUrl();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab]);

  useEffect(() => {
    if (authRestoring) return;
    
    // Redirect logic for incomplete profile onboarding
    if (user && role === 'landlord' && organization && !organization.profile_completed) {
      if (window.location.pathname !== '/complete-profile') {
        window.history.pushState(null, '', '/complete-profile');
      }
      return;
    }

    let path = '/home';
    let query = '';
    
    // If admin impersonation is active, preserve parameter
    if (impersonationSession) {
      query = `?impersonateOrgId=${impersonationSession.orgId}`;
    }
    
    if (activeTab === 'landlord_dashboard') {
      path = '/home';
    } else if (activeTab === 'landlord_properties') {
      path = '/properties';
      const qPrefix = query ? `${query}&` : '?';
      if (propertiesSubTab && propertiesSubTab !== 'properties') {
        query = `${qPrefix}tab=${propertiesSubTab}`;
      }
    } else if (activeTab === 'landlord_invoices') {
      path = '/billing';
      const qPrefix = query ? `${query}&` : '?';
      if (invoicesSubTab && invoicesSubTab !== 'overview') {
        query = `${qPrefix}tab=${invoicesSubTab}`;
        if (invoicesSubTab === 'banking') {
          const searchParams = new URLSearchParams(window.location.search);
          const bTab = searchParams.get('bankingTab');
          if (bTab) {
            query += `&bankingTab=${bTab}`;
          }
        }
      }
    } else if (activeTab === 'landlord_stats') {
      path = '/stats';
    } else if (activeTab === 'landlord_subscription') {
      path = '/subscription';
    } else if (activeTab === 'landlord_settings') {
      path = '/settings';
      const qPrefix = query ? `${query}&` : '?';
      if (settingsSubTab && settingsSubTab !== 'readiness') {
        query = `${qPrefix}tab=${settingsSubTab}`;
      }
    } else if (activeTab === 'admin_dashboard') {
      path = '/admin';
    } else if (activeTab.startsWith('admin_')) {
      const sub = activeTab.replace('admin_', '');
      path = `/admin/${sub === 'orgs' ? 'landlords' : sub === 'pricing' ? 'billing' : sub}`;
    } else if (activeTab === 'caretaker_dashboard') {
      path = '/caretaker';
    } else if (activeTab.startsWith('caretaker_')) {
      const sub = activeTab.replace('caretaker_', '');
      path = `/caretaker/${sub === 'readings' ? 'readings' : sub}`;
    } else {
      return; // Skip non-matched states
    }
    
    const targetUrl = path + query;
    if (window.location.pathname + window.location.search !== targetUrl) {
      window.history.pushState(null, '', targetUrl);
    }
  }, [activeTab, propertiesSubTab, invoicesSubTab, settingsSubTab, authRestoring, user, role, organization, impersonationSession]);

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
            clearInitialSubTab={() => setPropertiesSubTab(null)}
          />
        );
      case 'landlord_invoices':
        return (
          <Invoices
            organization={organization}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            initialSubTab={invoicesSubTab}
            clearInitialSubTab={() => setInvoicesSubTab(null)}
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
            clearInitialSubTab={() => setInvoicesSubTab(null)}
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
            clearInitialSubTab={() => setSettingsSubTab(null)}
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
        return <Caretaker user={user} activeRoute={activeTab} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} onChangeRoute={setActiveTab} />;

      // Super Admin Pages
      case 'admin_dashboard':
      case 'admin_orgs':
      case 'admin_pricing':
      case 'admin_errors':
      case 'admin_email':
      case 'admin_sms':
      case 'admin_audits':
      case 'admin_compliance':
        return <SuperAdmin activeRoute={activeTab} onImpersonateStart={handleImpersonateStart} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} onChangeRoute={setActiveTab} />;

      default:
        return <div>Tab not found.</div>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
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














