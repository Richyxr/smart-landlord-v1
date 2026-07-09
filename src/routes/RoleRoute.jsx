import React from 'react';
import ProtectedRoute from './ProtectedRoute.jsx';

export default function RoleRoute(props) {
  return <ProtectedRoute {...props} />;
}
