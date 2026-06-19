import React from 'react';

export default function SetupAlert({
  title,
  description,
  actionLabel = 'Review',
  icon = '⚠️',
  onClick,
  tone = 'primary'
}) {
  return (
    <button type="button" className={`sl-setup-alert sl-setup-${tone}`} onClick={onClick}>
      <div className="sl-setup-icon">{icon}</div>
      <div className="sl-setup-body">
        <div className="sl-setup-title">{title}</div>
        <div className="sl-setup-description">{description}</div>
      </div>
      <div className="sl-setup-action">{actionLabel}</div>
    </button>
  );
}
