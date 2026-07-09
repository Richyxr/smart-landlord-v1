import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  Home,
  ReceiptText,
  Settings,
} from 'lucide-react';

const iconMap = {
  home: Home,
  properties: Building2,
  billing: ReceiptText,
  stats: BarChart3,
  settings: Settings
};

const LANDLORD_PRIMARY_NAV = [
  { id: 'home', label: 'Home', path: '/home' },
  { id: 'properties', label: 'Properties', path: '/properties' },
  { id: 'billing', label: 'Billing', path: '/billing' },
  { id: 'stats', label: 'Stats', path: '/stats' },
  { id: 'settings', label: 'Settings', path: '/settings' }
];

export default function DesktopSidebar({ role }) {
  return (
    <aside className="desktop-sidebar">
      {/* Brand Header */}
      <div className="sidebar-brand">
        <img src="/icons/maskable-192.png" alt="Smart Landlord" className="sidebar-logo" />
        <span className="sidebar-brand-text">
          <span className="brand-smart">Smart</span>
          <span className="brand-landlord">Landlord</span>
        </span>
      </div>

      {/* Role Badge */}
      <div className="sidebar-role-container">
        <span className="badge badge-info sidebar-role-badge">
          {role.replace('_', ' ')}
        </span>
      </div>

      {/* Navigation Items */}
      <nav className="sidebar-nav">
        {LANDLORD_PRIMARY_NAV.map((item) => {
          const Icon = iconMap[item.id] || Home;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.id === 'home'}
              data-testid={item.id === 'stats' ? 'landlord_stats' : undefined}
              className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className="sidebar-icon" size={20} strokeWidth={2.3} />
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
