import * as React from "react";

const Card = React.forwardRef(({ className, style, ...props }, ref) => (
  <div
    ref={ref}
    className={`kpi-shadcn-card ${className || ''}`}
    style={{
      backgroundColor: 'var(--bg-surface-elevated, #020617)',
      border: '1px solid var(--border, #1e293b)',
      borderRadius: '16px',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      justify: 'space-between',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
      transition: 'transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
      cursor: 'pointer',
      ...style
    }}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef(({ className, style, ...props }, ref) => (
  <div
    ref={ref}
    className={`kpi-card-header ${className || ''}`}
    style={{
      display: 'flex',
      alignItems: 'center',
      justify: 'space-between',
      width: '100%',
      marginBottom: '12px',
      ...style
    }}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef(({ className, style, ...props }, ref) => (
  <h3
    ref={ref}
    className={`kpi-card-title ${className || ''}`}
    style={{
      fontSize: '11px',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: 'var(--text-muted, #94a3b8)',
      margin: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      ...style
    }}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef(({ className, style, ...props }, ref) => (
  <p
    ref={ref}
    style={{ fontSize: '12px', color: '#94a3b8', margin: 0, ...style }}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef(({ className, style, ...props }, ref) => (
  <div
    ref={ref}
    className={`kpi-card-body ${className || ''}`}
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      ...style
    }}
    {...props}
  />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef(({ className, style, ...props }, ref) => (
  <div
    ref={ref}
    style={{ display: 'flex', alignItems: 'center', marginTop: '12px', ...style }}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
