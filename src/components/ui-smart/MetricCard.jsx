import React from 'react';

export default function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'default',
  badge,
  badgeTone = 'default',
  onClick
}) {
  const isClickable = !!onClick;
  
  const handleKeyDown = (e) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  const getBadgeStyle = () => {
    if (badgeTone === 'danger') {
      return {
        background: 'rgba(239, 68, 68, 0.15)',
        color: '#f87171',
        border: '1px solid rgba(239, 68, 68, 0.3)'
      };
    }
    if (badgeTone === 'success') {
      return {
        background: 'rgba(34, 197, 94, 0.15)',
        color: '#4ade80',
        border: '1px solid rgba(34, 197, 94, 0.3)'
      };
    }
    if (badgeTone === 'warning') {
      return {
        background: 'rgba(245, 158, 11, 0.15)',
        color: '#fbbf24',
        border: '1px solid rgba(245, 158, 11, 0.3)'
      };
    }
    return {
      background: 'rgba(99, 102, 241, 0.15)',
      color: 'var(--primary, #818cf8)',
      border: '1px solid rgba(99, 102, 241, 0.3)'
    };
  };

  return (
    <div 
      className={`sl-metric-card sl-metric-${tone} ${isClickable ? 'sl-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      style={{
        position: 'relative',
        background: 'var(--bg-surface-elevated, #020617)',
        border: '1px solid var(--border, #1e293b)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        justify: 'space-between',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)'
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)';
          e.currentTarget.style.boxShadow = '0 12px 20px -5px rgba(168, 85, 247, 0.15)';
        }
      }}
      onMouseLeave={(e) => {
        if (isClickable) {
          e.currentTarget.style.transform = 'translateY(0px)';
          e.currentTarget.style.borderColor = 'var(--border, #1e293b)';
          e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.2)';
        }
      }}
    >
      <div className="sl-metric-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="sl-metric-label" style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {badge && (
            <span style={{
              fontSize: '10px',
              fontWeight: '700',
              padding: '2px 8px',
              borderRadius: '9999px',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              ...getBadgeStyle()
            }}>
              {badge}
            </span>
          )}
          {Icon && (
            <span className="sl-metric-icon" style={{ color: 'var(--primary, #818cf8)', display: 'flex', alignItems: 'center' }}>
              <Icon size={16} strokeWidth={2.4} />
            </span>
          )}
        </div>
      </div>
      
      <div className="sl-metric-value" style={{ fontSize: '24px', fontWeight: '800', fontFamily: 'var(--font-title, sans-serif)', color: 'var(--text-primary, #f8fafc)', margin: '4px 0 2px 0' }}>
        {value}
      </div>
      
      {helper && (
        <div className="sl-metric-helper" style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {helper}
        </div>
      )}
    </div>
  );
}
