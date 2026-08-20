import React, { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, Moon, Sun, ChevronDown, Building, BarChart3, ShieldCheck } from 'lucide-react';
import {
  THEME_MODES,
  applyThemeMode,
  getStoredThemeMode,
  resolveTheme,
  saveThemeMode
} from '../lib/themeMode.js';

export default function UserProfileDropdown({
  user,
  role,
  organization,
  onNavigate,
  onLogout
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState(getStoredThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getStoredThemeMode()));
  const dropdownRef = useRef(null);

  // Sync theme changes across app
  useEffect(() => {
    applyThemeMode(mode);
    setResolvedTheme(resolveTheme(mode));
  }, [mode]);

  const handleToggleTheme = () => {
    const nextMode = resolvedTheme === THEME_MODES.DARK ? THEME_MODES.LIGHT : THEME_MODES.DARK;
    setMode(nextMode);
    setResolvedTheme(nextMode);
    saveThemeMode(nextMode);
  };

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  const displayName = user?.name || user?.full_name || 'Landlord User';
  const displayEmail = user?.email || 'user@smartlandlord.com';
  const orgName = organization?.name || 'My Portfolio Workspace';
  const roleTitle = (role || 'landlord').replace('_', ' ').toUpperCase();
  const isDark = resolvedTheme === THEME_MODES.DARK;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* SHADCN AVATAR TRIGGER PILL */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="User Account Menu"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '4px 12px 4px 5px',
          background: isOpen ? 'var(--bg-surface-elevated)' : 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '9999px',
          cursor: 'pointer',
          transition: 'all 0.15s ease-in-out',
          outline: 'none',
          color: 'var(--text-primary)',
          boxShadow: isOpen ? '0 0 0 2px var(--primary-glow, rgba(99, 102, 241, 0.3))' : 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--primary)';
          e.currentTarget.style.background = 'var(--bg-surface-elevated)';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.background = 'var(--bg-surface)';
          }
        }}
      >
        {/* AVATAR CIRCLE */}
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          color: '#ffffff',
          fontWeight: '700',
          fontSize: '11px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: '1',
          letterSpacing: '0px',
          flexShrink: 0,
          overflow: 'hidden',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          border: '1px solid rgba(255, 255, 255, 0.2)'
        }}>
          {getInitials(displayName)}
        </div>

        {/* NAME & ROLE STYLING */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', lineHeight: 1.15 }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
            {displayName}
          </span>
          <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--primary)', letterSpacing: '0.6px', marginTop: '1px' }}>
            {roleTitle}
          </span>
        </div>

        <ChevronDown
          size={14}
          style={{
            color: 'var(--text-muted)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            marginLeft: '4px'
          }}
        />
      </button>

      {/* SHADCN POPOVER DROPDOWN MENU */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '260px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            padding: '6px',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          {/* USER HEADER & WORKSPACE INFO */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justify: 'center'
              }}>
                {getInitials(displayName)}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayName}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayEmail}
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '8px',
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--bg-surface)',
              fontSize: '11px',
              color: 'var(--text-primary)'
            }}>
              <Building size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</span>
            </div>
          </div>

          {/* MENU NAVIGATION ITEMS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {/* SETTINGS ITEM */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onNavigate) {
                  onNavigate(role === 'super_admin' ? 'admin_dashboard' : 'landlord_settings');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Settings size={15} style={{ color: 'var(--primary)' }} />
              <span>Settings & Integrations</span>
            </button>

            {/* STATS ITEM */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onNavigate) {
                  onNavigate('landlord_stats');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <BarChart3 size={15} style={{ color: 'var(--info, #3b82f6)' }} />
              <span>Financial Analytics</span>
            </button>

            {/* APPEARANCE MODE ITEM */}
            <button
              type="button"
              onClick={handleToggleTheme}
              style={{
                display: 'flex',
                alignItems: 'center',
                justify: 'space-between',
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {isDark ? <Moon size={15} style={{ color: '#a855f7' }} /> : <Sun size={15} style={{ color: '#f59e0b' }} />}
                <span>Appearance Mode</span>
              </div>
              <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 6px', textTransform: 'capitalize' }}>
                {isDark ? 'Dark' : 'Light'}
              </span>
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* LOGOUT ITEM */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              if (onLogout) onLogout();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--danger, #ef4444)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
