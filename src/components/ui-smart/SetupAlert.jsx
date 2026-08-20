import React from 'react';

export default function SetupAlert({
  title,
  description,
  actionLabel = 'Review',
  icon: Icon,
  onClick,
  tone = 'primary',
  progress = null // e.g. { completed: 2, total: 4, percent: 50 }
}) {
  const getToneStyles = () => {
    switch (tone) {
      case 'danger':
        return {
          border: '1px solid rgba(244, 63, 94, 0.4)',
          background: 'linear-gradient(135deg, rgba(136, 19, 55, 0.25) 0%, rgba(2, 6, 23, 0.95) 100%)',
          boxShadow: '0 0 15px rgba(244, 63, 94, 0.12)',
          iconColor: '#f43f5e',
          badgeBg: 'rgba(244, 63, 94, 0.15)',
          badgeColor: '#fb7185'
        };
      case 'warning':
        return {
          border: '1px solid rgba(245, 158, 11, 0.4)',
          background: 'linear-gradient(135deg, rgba(120, 53, 15, 0.25) 0%, rgba(2, 6, 23, 0.95) 100%)',
          boxShadow: '0 0 15px rgba(245, 158, 11, 0.12)',
          iconColor: '#f59e0b',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
          badgeColor: '#fcd34d'
        };
      case 'info':
        return {
          border: '1px solid rgba(14, 165, 233, 0.4)',
          background: 'linear-gradient(135deg, rgba(12, 74, 110, 0.25) 0%, rgba(2, 6, 23, 0.95) 100%)',
          boxShadow: '0 0 15px rgba(14, 165, 233, 0.12)',
          iconColor: '#38bdf8',
          badgeBg: 'rgba(14, 165, 233, 0.15)',
          badgeColor: '#7dd3fc'
        };
      default:
        return {
          border: '1px solid rgba(99, 102, 241, 0.4)',
          background: 'linear-gradient(135deg, rgba(49, 46, 129, 0.25) 0%, rgba(2, 6, 23, 0.95) 100%)',
          boxShadow: '0 0 15px rgba(99, 102, 241, 0.12)',
          iconColor: '#818cf8',
          badgeBg: 'rgba(99, 102, 241, 0.15)',
          badgeColor: '#a5b4fc'
        };
    }
  };

  const styleConfig = getToneStyles();

  return (
    <button
      type="button"
      className="sl-setup-alert"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        padding: '16px',
        borderRadius: '12px',
        border: styleConfig.border,
        background: styleConfig.background,
        boxShadow: styleConfig.boxShadow,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        outline: 'none'
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
        {Icon && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: styleConfig.badgeBg,
            color: styleConfig.iconColor,
            flexShrink: 0
          }}>
            <Icon size={20} strokeWidth={2.4} />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{title}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px', lineHeight: '1.4' }}>
            {description}
          </div>
        </div>

        <div style={{
          fontSize: '12px',
          fontWeight: '700',
          padding: '6px 12px',
          borderRadius: '8px',
          background: styleConfig.badgeBg,
          color: styleConfig.badgeColor,
          border: `1px solid ${styleConfig.iconColor}40`,
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}>
          {actionLabel}
        </div>
      </div>

      {/* STEP PROGRESS BAR INTEGRATION (SHADCN PROGRESS PRIMITIVE) */}
      {progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '600', color: '#a5b4fc' }}>
            <span>Progress: {progress.completed} of {progress.total} Tasks Completed</span>
            <span>{progress.percent}%</span>
          </div>
          <div style={{ height: '6px', width: '100%', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '9999px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <div style={{
              height: '100%',
              width: `${progress.percent}%`,
              background: 'linear-gradient(90deg, #6366f1 0%, #a855f7 100%)',
              borderRadius: '9999px',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}
    </button>
  );
}
