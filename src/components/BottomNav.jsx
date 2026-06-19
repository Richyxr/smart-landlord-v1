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

export default function BottomNav({ role, activeTab, onNavigate }) {
  const getItems = () => {
    switch (role) {
      case 'admin':
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
          { id: 'landlord_invoices', label: 'Bills', icon: ReceiptText },
          { id: 'landlord_reconciliation', label: 'Reconcile', icon: Handshake },
          { id: 'landlord_settings', label: 'Settings', icon: Settings }
        ];
    }
  };

  const items = getItems();

  return (
    <div className="bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <Icon className="nav-icon" size={21} strokeWidth={2.3} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
