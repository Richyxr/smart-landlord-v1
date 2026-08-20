import React from 'react';
import { getInitials } from '../../lib/utils.js';

export function TenantAvatar({ name, className = '', size = 'size-10', style = {} }) {
  const initials = getInitials(name);
  return (
    <div 
      className={`tenant-avatar ${size} rounded-full bg-purple-600 text-white font-bold flex items-center justify-center border border-purple-400/30 shadow-sm shrink-0 ${className}`}
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: '#9333ea',
        color: '#ffffff',
        fontWeight: '700',
        fontSize: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(168, 85, 247, 0.3)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        flexShrink: 0,
        ...style
      }}
      title={name || 'Tenant'}
    >
      {initials}
    </div>
  );
}

export default TenantAvatar;
