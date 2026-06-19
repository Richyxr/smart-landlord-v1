import React from 'react';

export default function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}) {
  return (
    <button className={`sl-button sl-button-${variant} sl-button-${size} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
