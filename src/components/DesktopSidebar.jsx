import React from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Home,
  MessageCircle,
  ReceiptText,
  Settings,
  Tags,
  WalletCards,
  Zap,
  Handshake
} from 'lucide-react';

export default function DesktopSidebar({ role, activeTab, onChangeTab }) {
  const getItems = () => {
    switch (role) {
      case 'admin':
      case 'super_admin':
        return [
          { id: 'admin_dashboard', label: 'Platform', icon: BarChart3 },
          { id: 'admin_orgs', label: 'Landlords', icon: Building2 },
          { id: 'admin_pricing', label: 'Pricing', icon: Tags },
          { id: 'admin_errors', label: 'Errors', icon: AlertTriangle }
        ];
      case 'caretaker':
        return [
          { id: 'caretaker_dashboard', label: 'Home', icon: Home },
          { id: 'caretaker_readings', label: 'Readings', icon: Zap },
          { id: 'caretaker_messages', label: 'Messages', icon: MessageCircle }
        ];
      default:
        return [
          { id: 'landlord_dashboard', label: 'Home', icon: Home },
          { id: 'landlord_properties', label: 'Properties', icon: Building2 },
          { id: 'landlord_invoices', label: 'Billing', icon: ReceiptText },

          // --- RECONCILIATION MODULE FAMILY ---
          // Future Sub-Navigation Hierarchy:
          // Reconciliation
          //   ├── Payment Automation
          //   ├── Review Queue (payment evidence)
          //   ├── Unmatched Payments
          //   └── Imported Statements
          { id: 'landlord_reconciliation', label: 'Reconcile', icon: Handshake },
          { id: 'landlord_payment_evidence', label: 'Review Queue', icon: WalletCards },

          { id: 'landlord_settings', label: 'Settings', icon: Settings }
        ];
    }
  };

  const items = getItems();

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
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              onClick={() => onChangeTab(item.id)}
            >
              <Icon className="sidebar-icon" size={20} strokeWidth={2.3} />
              <span className="sidebar-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
