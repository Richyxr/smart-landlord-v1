import * as React from "react";

const badgeVariantStyles = {
  default: {
    background: 'rgba(99, 102, 241, 0.15)',
    color: 'var(--primary, #818cf8)',
    border: '1px solid rgba(99, 102, 241, 0.3)'
  },
  secondary: {
    background: 'rgba(51, 65, 85, 0.5)',
    color: '#cbd5e1',
    border: '1px solid rgba(71, 85, 105, 0.6)'
  },
  success: {
    background: 'rgba(34, 197, 94, 0.15)',
    color: '#4ade80',
    border: '1px solid rgba(34, 197, 94, 0.3)'
  },
  danger: {
    background: 'rgba(239, 68, 68, 0.15)',
    color: '#f87171',
    border: '1px solid rgba(239, 68, 68, 0.3)'
  },
  warning: {
    background: 'rgba(245, 158, 11, 0.15)',
    color: '#fbbf24',
    border: '1px solid rgba(245, 158, 11, 0.3)'
  },
  outline: {
    background: 'transparent',
    color: '#e2e8f0',
    border: '1px solid #475569'
  }
};

function Badge({ className, variant = "default", style, ...props }) {
  const currentVariant = badgeVariantStyles[variant] || badgeVariantStyles.default;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '9999px',
        padding: '2px 8px',
        fontSize: '10px',
        fontWeight: '700',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        ...currentVariant,
        ...style
      }}
      {...props}
    />
  );
}

export { Badge };
