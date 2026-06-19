import React from 'react';

export default function DashboardCard({
  children,
  className = '',
  accent = 'default',
  interactive = false,
  onClick
}) {
  const classes = [
    'sl-card',
    accent !== 'default' ? `sl-card-${accent}` : '',
    interactive ? 'sl-card-interactive' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <section className={classes} onClick={onClick}>
      {children}
    </section>
  );
}
