import React from 'react';

export default function EmptyState({
  icon = '—',
  title,
  description
}) {
  return (
    <div className="sl-empty-state">
      <div className="sl-empty-icon">{icon}</div>
      {title && <div className="sl-empty-title">{title}</div>}
      {description && <div className="sl-empty-description">{description}</div>}
    </div>
  );
}
