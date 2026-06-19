import React from 'react';
import DashboardCard from './DashboardCard.jsx';

export default function SectionCard({
  title,
  action,
  children,
  className = ''
}) {
  return (
    <DashboardCard className={className}>
      <div className="sl-section-header">
        <h3 className="sl-section-title">{title}</h3>
        {action}
      </div>
      {children}
    </DashboardCard>
  );
}
