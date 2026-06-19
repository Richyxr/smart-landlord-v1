import React from 'react';

export default function EmptyState({
  icon: Icon,
  title,
  description
}) {
  return (
    <div className="sl-empty-state">
      {Icon && (
        <div className="sl-empty-icon">
          <Icon size={22} strokeWidth={2.2} />
        </div>
      )}
      {title && <div className="sl-empty-title">{title}</div>}
      {description && <div className="sl-empty-description">{description}</div>}
    </div>
  );
}
