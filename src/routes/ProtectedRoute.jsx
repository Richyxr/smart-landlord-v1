import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getAuthRedirectPath } from '../config/navigation.js';

export default function ProtectedRoute({
  user,
  role,
  organization,
  allowedRoles,
  requireProfileComplete = false,
  children
}) {
  const location = useLocation();
  const pathName = location.pathname;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to={getAuthRedirectPath(role, organization)} replace />;
  }

  if (
    requireProfileComplete &&
    role === 'landlord' &&
    organization &&
    organization.profile_completed === false &&
    pathName !== '/complete-profile'
  ) {
    return <Navigate to="/complete-profile" replace />;
  }

  return children || <Outlet />;
}
