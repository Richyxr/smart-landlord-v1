import React from 'react';

export default function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'default'
}) {
  return (
    <div className={`sl-metric-card sl-metric-${tone}`}>
      <div className="sl-metric-top">
        <span className="sl-metric-label">{label}</span>
        {icon && <span className="sl-metric-icon">{icon}</span>}
      </div>
      <div className="sl-metric-value">{value}</div>
      {helper && <div className="sl-metric-helper">{helper}</div>}
    </div>
  );
}
