import React from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Auth from '../pages/Auth.jsx';
import CompleteProfile from '../pages/CompleteProfile.jsx';
import LandlordDashboard from '../pages/LandlordDashboard.jsx';
import Properties from '../pages/Properties.jsx';
import Invoices from '../pages/Invoices.jsx';
import Stats from '../pages/Stats.jsx';
import Settings from '../pages/Settings.jsx';
import Caretaker from '../pages/Caretaker.jsx';
import SuperAdmin from '../pages/SuperAdmin.jsx';
import AppShell from '../layouts/AppShell.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';
import {
  getAuthRedirectPath,
  normalizeAdminSection,
  normalizeBankingSection,
  normalizeBillingSection,
  normalizeCaretakerSection,
  normalizeLandlordSection,
  normalizeSettingsSection
} from '../config/navigation.js';

function mapLandlordNavigateTarget(page, subTab) {
  if (page === 'landlord_reconciliation' || page === 'landlord_payment_evidence') {
    return '/billing/banking/import';
  }

  if (page === 'landlord_dashboard') return '/home';
  if (page === 'landlord_properties') {
    return `/properties/${subTab || 'properties'}`;
  }
  if (page === 'landlord_invoices') {
    if (!subTab || subTab === 'overview' || subTab === 'due_tenants') return '/billing/overview';
    if (subTab === 'banking') return '/billing/banking/import';
    return `/billing/${subTab}`;
  }
  if (page === 'landlord_settings') {
    const sectionMap = {
      readiness: 'readiness',
      integrations: 'integrations',
      security_pin: 'security-pin',
      readings: 'caretaker-readings',
      archive: 'archive',
      audits: 'audit-logs',
      notifications: 'notifications',
      compliance: 'compliance'
    };
    const section = sectionMap[subTab] || 'readiness';
    return `/settings/${section}`;
  }
  if (page === 'landlord_stats') return '/stats';
  return '/home';
}

function RootRedirect({ user, role, organization }) {
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getAuthRedirectPath(role, organization)} replace />;
}

function PublicAuthRoute({ user, role, organization, children }) {
  if (user) {
    return <Navigate to={getAuthRedirectPath(role, organization)} replace />;
  }
  return children;
}

function PropertiesAliasRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  const nextSection = tab === 'units' || tab === 'tenants' || tab === 'staff' ? tab : 'properties';
  return <Navigate replace to={`/properties/${nextSection}`} />;
}

function LandlordDashboardRoute({ organization, refreshTrigger }) {
  const navigate = useNavigate();
  return (
    <LandlordDashboard
      organization={organization}
      refreshTrigger={refreshTrigger}
      onNavigate={(page, subTab) => navigate(mapLandlordNavigateTarget(page, subTab))}
    />
  );
}

function BillingAliasRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  const bankingTab = params.get('bankingTab');

  if (tab === 'banking') {
    const section = ['import', 'matching', 'history', 'payments'].includes(bankingTab) ? bankingTab : 'import';
    return <Navigate replace to={`/billing/banking/${section}`} />;
  }

  return <Navigate replace to="/billing/overview" />;
}

function SettingsAliasRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  const section = tab === 'security_pin' ? 'security-pin' : 'readiness';
  return <Navigate replace to={`/settings/${section}`} />;
}

function PropertySectionRoute(props) {
  const { section } = useParams();
  const navigate = useNavigate();
  const normalized = normalizeLandlordSection(section);

  if (section && normalized !== section) {
    return <Navigate replace to={`/properties/${normalized}`} />;
  }

  return (
    <Properties
      {...props}
      activeSection={normalized}
      key={normalized}
      onSectionChange={(nextSection) => navigate(`/properties/${nextSection}`)}
    />
  );
}

function BillingSectionRoute(props) {
  const { section, bankingSection } = useParams();
  const navigate = useNavigate();
  const normalizedSection = normalizeBillingSection(section);
  const normalizedBankingSection = normalizeBankingSection(bankingSection);

  if (!section) {
    return <Navigate replace to="/billing/overview" />;
  }

  if (section === 'banking' && !bankingSection) {
    return <Navigate replace to="/billing/banking/import" />;
  }

  if (section === 'banking' && bankingSection && normalizedBankingSection !== bankingSection) {
    return <Navigate replace to={`/billing/banking/${normalizedBankingSection}`} />;
  }

  if (section !== 'banking' && normalizedSection !== section) {
    return <Navigate replace to={`/billing/${normalizedSection}`} />;
  }

  return (
    <Invoices
      {...props}
      activeSection={normalizedSection}
      bankingSection={normalizedBankingSection}
      key={`${normalizedSection}:${normalizedBankingSection}`}
      onSectionChange={(nextSection) => {
        if (nextSection === 'banking') {
          navigate('/billing/banking/import');
        } else {
          navigate(`/billing/${nextSection}`);
        }
      }}
      onBankingSectionChange={(nextSection) => navigate(`/billing/banking/${nextSection}`)}
    />
  );
}

function SettingsSectionRoute(props) {
  const { section } = useParams();
  const navigate = useNavigate();
  const normalized = normalizeSettingsSection(section);

  if (section && normalized !== section.replace(/_/g, '-')) {
    return <Navigate replace to={`/settings/${normalized}`} />;
  }

  return (
    <Settings
      {...props}
      activeSection={normalized}
      key={normalized}
      onSectionChange={(nextSection) => navigate(`/settings/${nextSection}`)}
      onNavigate={(page, subTab) => navigate(mapLandlordNavigateTarget(page, subTab))}
    />
  );
}

function CaretakerSectionRoute(props) {
  const { section } = useParams();
  const navigate = useNavigate();
  const normalized = normalizeCaretakerSection(section);
  const activeSection = normalized === 'readings' ? 'submit' : normalized;

  if (section && normalized !== section) {
    return <Navigate replace to={`/caretaker/${normalized}`} />;
  }

  return (
    <Caretaker
      {...props}
      key={activeSection}
      activeSection={activeSection}
      onSectionChange={(nextSection) => navigate(nextSection === 'dashboard' ? '/caretaker' : `/caretaker/${nextSection === 'submit' ? 'readings' : nextSection}`)}
    />
  );
}

function SuperAdminSectionRoute(props) {
  const { section } = useParams();
  const navigate = useNavigate();
  const normalized = normalizeAdminSection(section);

  if (section && normalized !== section) {
    return <Navigate replace to={normalized === 'dashboard' ? '/admin' : `/admin/${normalized}`} />;
  }

  return (
    <SuperAdmin
      {...props}
      key={normalized}
      activeSection={normalized}
      onSectionChange={(nextSection) => navigate(nextSection === 'dashboard' ? '/admin' : `/admin/${nextSection}`)}
    />
  );
}

function CompleteProfileRoute(props) {
  const { role, organization } = props;

  if (role !== 'landlord') {
    return <Navigate to={getAuthRedirectPath(role, organization)} replace />;
  }

  if (organization && organization.profile_completed) {
    return <Navigate to={getAuthRedirectPath(role, organization)} replace />;
  }

  return <CompleteProfile {...props} />;
}

export default function AppRouter({
  user,
  role,
  organization,
  isLocked,
  impersonationSession,
  onExitImpersonation,
  onLogout,
  demoMode,
  onChangeRole,
  onTriggerLockout,
  onRefreshData,
  refreshTrigger,
  onRefresh,
  onUnlockLockout,
  onImpersonateStart,
  onUpdateOrganization,
  onAuthSuccess
}) {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect user={user} role={role} organization={organization} />} />

        <Route
          path="/login"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/reset-pin"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/verify-email"
          element={
            <PublicAuthRoute user={user} role={role} organization={organization}>
            <Auth onAuthSuccess={onAuthSuccess} />
            </PublicAuthRoute>
          }
        />

      <Route
        path="/complete-profile"
        element={
          <ProtectedRoute user={user} role={role} organization={organization} allowedRoles={['landlord']}>
            <CompleteProfileRoute
              user={user}
              role={role}
              organization={organization}
              onComplete={onAuthSuccess}
            />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute
            user={user}
            role={role}
            organization={organization}
            allowedRoles={['landlord']}
            requireProfileComplete
          >
            <AppShell
              role={role}
              organization={organization}
              isLocked={isLocked}
              refreshTrigger={refreshTrigger}
              impersonationSession={impersonationSession}
              onExitImpersonation={onExitImpersonation}
              onLogout={onLogout}
              onUnlockLockout={onUnlockLockout}
              demoMode={demoMode}
              onChangeRole={onChangeRole}
              onTriggerLockout={onTriggerLockout}
              onRefreshData={onRefreshData}
            />
          </ProtectedRoute>
        }
      >
        <Route
          path="/home"
          element={<LandlordDashboardRoute organization={organization} refreshTrigger={refreshTrigger} />}
        />
        <Route path="/properties" element={<PropertiesAliasRoute />} />
        <Route
          path="/properties/:section"
          element={
            <PropertySectionRoute
              organization={organization}
              refreshTrigger={refreshTrigger}
              onRefresh={onRefresh}
              onUpdateOrganization={onUpdateOrganization}
            />
          }
        />
        <Route path="/billing" element={<BillingAliasRoute />} />
        <Route path="/billing/banking" element={<Navigate replace to="/billing/banking/import" />} />
        <Route
          path="/billing/banking/:bankingSection"
          element={
            <BillingSectionRoute
              organization={organization}
              refreshTrigger={refreshTrigger}
              onRefresh={onRefresh}
              user={user}
              role={role}
            />
          }
        />
        <Route
          path="/billing/:section"
          element={
            <BillingSectionRoute
              organization={organization}
              refreshTrigger={refreshTrigger}
              onRefresh={onRefresh}
              user={user}
              role={role}
            />
          }
        />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<SettingsAliasRoute />} />
        <Route
          path="/settings/:section"
          element={
            <SettingsSectionRoute
              organization={organization}
              refreshTrigger={refreshTrigger}
              onRefresh={onRefresh}
              onUpdateOrganization={onUpdateOrganization}
              role={role}
            />
          }
        />
      </Route>

      <Route
        element={
          <ProtectedRoute user={user} role={role} organization={organization} allowedRoles={['caretaker']}>
            <CaretakerSectionRoute user={user} refreshTrigger={refreshTrigger} onRefresh={onRefresh} />
          </ProtectedRoute>
        }
      >
        <Route path="/caretaker" element={<CaretakerSectionRoute user={user} refreshTrigger={refreshTrigger} onRefresh={onRefresh} />} />
        <Route path="/caretaker/:section" element={<CaretakerSectionRoute user={user} refreshTrigger={refreshTrigger} onRefresh={onRefresh} />} />
      </Route>

        <Route
          element={
            <ProtectedRoute user={user} role={role} organization={organization} allowedRoles={['super_admin']}>
            <SuperAdminSectionRoute onRefresh={onRefresh} onImpersonateStart={onImpersonateStart} refreshTrigger={refreshTrigger} />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<SuperAdminSectionRoute onRefresh={onRefresh} onImpersonateStart={onImpersonateStart} refreshTrigger={refreshTrigger} />} />
        <Route path="/admin/:section" element={<SuperAdminSectionRoute onRefresh={onRefresh} onImpersonateStart={onImpersonateStart} refreshTrigger={refreshTrigger} />} />
      </Route>

      <Route
        path="*"
        element={<RootRedirect user={user} role={role} organization={organization} />}
      />
    </Routes>
  );
}
