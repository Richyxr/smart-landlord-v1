import React from 'react';

export default function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'default'
}) {
  return (
    <div className={`sl-metric-card sl-metric-${tone}`}>
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
