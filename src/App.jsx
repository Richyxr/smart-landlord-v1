import React, { useState, useEffect } from 'react';
import Auth from './pages/Auth.jsx';
import LandlordDashboard from './pages/LandlordDashboard.jsx';
import Properties from './pages/Properties.jsx';
import Invoices from './pages/Invoices.jsx';
import Reconciliation from './pages/Reconciliation.jsx';
import Settings from './pages/Settings.jsx';
import Caretaker from './pages/Caretaker.jsx';
import SuperAdmin from './pages/SuperAdmin.jsx';
import SaaSInvoices from './pages/SaaSInvoices.jsx';

import BottomNav from './components/BottomNav.jsx';
import ImpersonationBanner from './components/ImpersonationBanner.jsx';
import DevSwitcher from './components/DevSwitcher.jsx';
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
  const [authRestoring, setAuthRestoring] = useState(true);
  
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

  // Load a demo session only for local/demo builds.
  useEffect(() => {
    if (demoMode && !auth.currentUser) {
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
      setActiveTab('admin_dashboard');
    } else if (authRole === 'caretaker') {
      setActiveTab('caretaker_dashboard');
    } else {
      setActiveTab('landlord_dashboard');
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

  const handleMockUnlock = () => {
    setIsLocked(false);
    triggerRefresh();
  };

  if (authRestoring) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', textAlign: 'center' }}>
        <h2>Restoring your session...</h2>
        <p>Please wait while Smart Landlord signs you back in.</p>
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
        return <LandlordDashboard organization={organization} onNavigate={setActiveTab} refreshTrigger={refreshTrigger} />;
      case 'landlord_properties':
        return <Properties organization={organization} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;
      case 'landlord_invoices':
        return <Invoices organization={organization} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;
      case 'landlord_reconciliation':
        return <Reconciliation organization={organization} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;
      case 'landlord_settings':
        return <Settings organization={organization} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;
      
      // Caretaker Pages
      case 'caretaker_dashboard':
      case 'caretaker_readings':
      case 'caretaker_messages':
      case 'caretaker_profile':
        return <Caretaker user={user} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

      // Super Admin Pages
      case 'admin_dashboard':
      case 'admin_orgs':
      case 'admin_pricing':
      case 'admin_errors':
        return <SuperAdmin onImpersonateStart={handleImpersonateStart} refreshTrigger={refreshTrigger} onRefresh={triggerRefresh} />;

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
      ) : (
        <>
          {/* Main App Layout Header */}
          <div className="app-header">
            <span className="logo-text">Smart Landlord</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-info" style={{ textTransform: 'uppercase', fontSize: '9px' }}>
                {role.replace('_', ' ')}
              </span>
              <button 
                className="btn btn-secondary btn-sm" 
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
        </>
      )}
    </div>
  );
}

