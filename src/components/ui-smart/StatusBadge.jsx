import React from 'react';

export default function StatusBadge({ children, tone = 'default' }) {
  return (
    <span className={`sl-status-badge sl-status-${tone}`}>
      {children}
    </span>
  );
}
