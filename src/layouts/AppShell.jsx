import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav.jsx';
import DesktopSidebar from '../components/DesktopSidebar.jsx';
import ThemeModeToggle from '../components/ThemeModeToggle.jsx';
import ImpersonationBanner from '../components/ImpersonationBanner.jsx';
import DevSwitcher from '../components/DevSwitcher.jsx';
import SaaSInvoices from '../pages/SaaSInvoices.jsx';

export default function AppShell({
  role,
  organization,
  isLocked,
  refreshTrigger,
  impersonationSession,
  onExitImpersonation,
  onLogout,
  onUnlockLockout,
  demoMode,
  onChangeRole,
  onTriggerLockout,
  onRefreshData
}) {
  const navigate = useNavigate();
  const showPrimaryNav = role === 'landlord' && !isLocked;
  const showDesktopNav = role === 'landlord';

  const handleLogout = async () => {
    await onLogout?.();
    navigate('/login', { replace: true });
  };

  if (role === 'landlord' && isLocked) {
    return (
      <SaaSInvoices
        organization={organization}
        refreshTrigger={refreshTrigger}
        onRefresh={onUnlockLockout}
        forceShowLock
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
      {impersonationSession && (
        <ImpersonationBanner session={impersonationSession} onExit={onExitImpersonation} />
      )}

      <div className="responsive-app-shell">
        {showDesktopNav && (
          <DesktopSidebar role={role} />
        )}

        <div className="responsive-main-shell">
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
                {String(role || 'landlord').replace('_', ' ')}
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

          <div className="app-content">
            <Outlet />
          </div>

          {showPrimaryNav && (
            <BottomNav role={role} />
          )}

          {demoMode && (
            <DevSwitcher
              currentRole={role}
              onChangeRole={onChangeRole}
              currentOrgId={organization ? organization.id : 1}
              onTriggerLockout={onTriggerLockout}
              onRefreshData={onRefreshData}
            />
          )}
        </div>
      </div>
    </div>
  );
}
