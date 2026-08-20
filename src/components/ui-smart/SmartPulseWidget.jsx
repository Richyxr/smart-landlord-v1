import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  AlertTriangle, 
  Info, 
  CheckCircle, 
  ShieldAlert, 
  ArrowRight, 
  X, 
  RefreshCw,
  Gauge
} from 'lucide-react';

export default function SmartPulseWidget({ role = 'landlord', onActionTrigger }) {
  const [nudges, setNudges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNudges = async () => {
    try {
      const res = await fetch(`/api/nudges?role=${role}`);
      if (res.ok) {
        const data = await res.json();
        setNudges(data.nudges || []);
      }
    } catch (err) {
      console.error('Failed to fetch system nudges:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNudges();
    const interval = setInterval(fetchNudges, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [role]);

  const handleResolve = async (nudgeId, e) => {
    if (e) e.stopPropagation();
    try {
      setNudges(prev => prev.filter(n => n.id !== nudgeId));
      await fetch(`/api/nudges/${nudgeId}/resolve`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to resolve nudge:', err);
    }
  };

  const handleActionClick = (nudge) => {
    if (onActionTrigger) {
      const handled = onActionTrigger(nudge);
      if (handled) return;
    }

    if (nudge.action_url && typeof window !== 'undefined') {
      window.location.href = nudge.action_url;
    }
  };

  if (loading || nudges.length === 0) {
    return null; // Silent when no action items required
  }

  const severityBadge = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          badgeClass: 'sl-nudge-badge-critical',
          icon: <ShieldAlert size={14} className="text-red-400" />
        };
      case 'warning':
        return {
          badgeClass: 'sl-nudge-badge-warning',
          icon: <AlertTriangle size={14} className="text-amber-400" />
        };
      case 'success':
        return {
          badgeClass: 'sl-nudge-badge-success',
          icon: <CheckCircle size={14} className="text-emerald-400" />
        };
      default:
        return {
          badgeClass: 'sl-nudge-badge-info',
          icon: <Info size={14} className="text-indigo-400" />
        };
    }
  };

  return (
    <div className="sl-pulse-container animate-fade-in">
      {/* Header bar */}
      <div className="sl-pulse-header">
        <div className="sl-pulse-title">
          <span className="sl-pulse-indicator">
            <span className="sl-pulse-ping"></span>
            <span className="sl-pulse-dot"></span>
          </span>
          <Zap size={16} className="sl-pulse-icon" />
          <span className="sl-pulse-text">System Intelligence</span>
          <span className="sl-pulse-count-badge">
            {nudges.length} {nudges.length === 1 ? 'Action Needed' : 'Actions Needed'}
          </span>
        </div>
        <button 
          onClick={() => { setRefreshing(true); fetchNudges(); }} 
          className="sl-pulse-refresh-btn"
          title="Refresh updates"
        >
          <RefreshCw size={13} className={refreshing ? 'spin-animation' : ''} />
        </button>
      </div>

      {/* Nudge list */}
      <div className="sl-pulse-list">
        {nudges.map(nudge => {
          const { badgeClass, icon } = severityBadge(nudge.severity);
          return (
            <div key={nudge.id} className="sl-nudge-card">
              <div className="sl-nudge-top">
                <div className="sl-nudge-meta">
                  <span className={`sl-nudge-badge ${badgeClass}`}>
                    {icon}
                    <span className="capitalize">{(nudge?.category || 'system').replace('_', ' ')}</span>
                  </span>
                </div>
                <button 
                  onClick={(e) => handleResolve(nudge.id, e)} 
                  className="sl-nudge-dismiss-btn"
                  title="Dismiss update"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="sl-nudge-body">
                <h4 className="sl-nudge-title">{nudge.title}</h4>
                <p className="sl-nudge-message">{nudge.message}</p>
              </div>

              {nudge.action_label && (
                <div className="sl-nudge-footer">
                  <button 
                    onClick={() => handleActionClick(nudge)}
                    className="sl-nudge-cta-btn"
                  >
                    {nudge.category === 'meter_reading' && <Gauge size={14} />}
                    <span>{nudge.action_label}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
