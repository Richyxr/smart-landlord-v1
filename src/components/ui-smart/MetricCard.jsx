import React from 'react';

export default function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'default',
  onClick
}) {
  const isClickable = !!onClick;
  
  const handleKeyDown = (e) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div 
      className={`sl-metric-card sl-metric-${tone} ${isClickable ? 'sl-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      style={isClickable ? { cursor: 'pointer' } : undefined}
    >
      <div className="sl-metric-top">
        <span className="sl-metric-label">{label}</span>
        {Icon && (
          <span className="sl-metric-icon">
            <Icon size={16} strokeWidth={2.4} />
          </span>
        )}
      </div>
      <div className="sl-metric-value">{value}</div>
      {helper && <div className="sl-metric-helper">{helper}</div>}
    </div>
  );
}
