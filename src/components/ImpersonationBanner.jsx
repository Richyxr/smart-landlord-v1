import React from 'react';

export default function ImpersonationBanner({ session, onExit }) {
  if (!session) return null;

  return (
    <div className="impersonation-banner">
      <span>
        <strong>Admin Impersonation Active:</strong> Viewing {session.orgName || 'Landlord Dashboard'}
      </span>
      <button className="impersonation-btn-exit" onClick={onExit}>
        Exit Impersonation
      </button>
    </div>
  );
}
