import React from 'react';

export default function BottomNav({ role, activeTab, onChangeTab }) {
  // Define nav links based on role
  const getNavItems = () => {
    switch (role) {
      case 'super_admin':
        return [
          { id: 'admin_dashboard', label: 'Platform', icon: '📊' },
          { id: 'admin_orgs', label: 'Landlords', icon: '🏢' },
          { id: 'admin_pricing', label: 'Pricing', icon: '⚙️' },
          { id: 'admin_errors', label: 'Errors', icon: '⚠️' }
        ];
      case 'caretaker':
        return [
          { id: 'caretaker_dashboard', label: 'Home', icon: '🏡' },
          { id: 'caretaker_readings', label: 'Readings', icon: '⚡' },
          { id: 'caretaker_messages', label: 'Messages', icon: '💬' },
          { id: 'caretaker_profile', label: 'Profile', icon: '👤' }
        ];
      case 'landlord':
      default:
        return [
          { id: 'landlord_dashboard', label: 'Home', icon: '🏡' },
          { id: 'landlord_properties', label: 'Properties', icon: '🏢' },
          { id: 'landlord_invoices', label: 'Bills', icon: '🧾' },
          { id: 'landlord_reconciliation', label: 'Reconcile', icon: '🤝' },
          { id: 'landlord_settings', label: 'Settings', icon: '⚙️' }
        ];
    }
  };

  const items = getNavItems();

  return (
    <div className="bottom-nav">
      {items.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${activeTab === item.id ? 'nav-item-active' : ''}`}
          onClick={() => onChangeTab(item.id)}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
