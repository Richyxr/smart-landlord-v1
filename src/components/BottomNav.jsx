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

export default function BottomNav() {
  return (
    <div className="bottom-nav">
      {LANDLORD_PRIMARY_NAV.map((item) => {
        const Icon = iconMap[item.id] || Home;
        return (
          <NavLink
            key={item.id}
            to={item.path}
            end={item.id === 'home'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon className="nav-icon" size={21} strokeWidth={2.3} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
