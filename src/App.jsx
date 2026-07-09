import React, { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
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
import AppRouter from './routes/AppRouter.jsx';
import { clearSessionToken, getSessionToken, setSessionToken } from './lib/session.js';
import { auth } from './lib/firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const demoMode =
  import.meta.env.VITE_DEMO_MODE === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false');

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

  return (
    <>
      <BrowserRouter>
        <AppRouter
          user={user}
          role={role}
          organization={organization}
          isLocked={isLocked}
          impersonationSession={impersonationSession}
          onExitImpersonation={handleExitImpersonation}
          onLogout={handleLogout}
          onUnlockLockout={handleMockUnlock}
          demoMode={demoMode}
          onChangeRole={handleRoleChange}
          onTriggerLockout={() => setIsLocked(true)}
          onRefreshData={triggerRefresh}
          refreshTrigger={refreshTrigger}
          onRefresh={triggerRefresh}
          onImpersonateStart={handleImpersonateStart}
          onUpdateOrganization={(updatedOrg) => setOrganization(updatedOrg)}
          onAuthSuccess={handleAuthSuccess}
        />
      </BrowserRouter>
      <Toaster position="top-right" richColors />
      <InstallPrompt />
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
      {promptState && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '380px', padding: '20px' }}>
            <h3 className="card-title" style={{ fontSize: '15px', fontWeight: '800', marginBottom: '8px', borderBottom: 'none', paddingBottom: 0 }}>
              {promptState.title}
            </h3>
            <input
              className="form-control"
              style={{ marginBottom: '16px' }}
              placeholder={promptState.placeholder}
              defaultValue={promptState.defaultValue}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptState.onSubmit?.(e.target.value);
                  setPromptState(null);
                }
              }}
            />
            <div className="flex-gap" style={{ justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  promptState.onCancel?.();
                  setPromptState(null);
                }}
                style={{ minWidth: '70px' }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  const input = e.currentTarget.parentElement.parentElement.querySelector('input');
                  promptState.onSubmit?.(input?.value || '');
                  setPromptState(null);
                }}
                style={{ minWidth: '70px' }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

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
        return <Caretaker user={user} activeRoute={activeTab} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

      // Super Admin Pages
      case 'admin_dashboard':
      case 'admin_orgs':
      case 'admin_pricing':
      case 'admin_errors':
        return <SuperAdmin activeRoute={activeTab} onImpersonateStart={handleImpersonateStart} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

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














