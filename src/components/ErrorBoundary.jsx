import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Check for chunk load errors which can happen after deployments when cached code splits are stale.
    if (error.name === 'ChunkLoadError' || (error.message && error.message.includes('Failed to fetch dynamically imported module'))) {
      const hasReloaded = window.sessionStorage.getItem('chunk_load_reloaded');
      if (!hasReloaded) {
        window.sessionStorage.setItem('chunk_load_reloaded', 'true');
        window.location.reload();
        return;
      }
    }
    
    // Log the error to an error reporting service if available
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.sessionStorage.removeItem('chunk_load_reloaded');
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: 'var(--bg-body, #f4f6f8)',
          padding: '20px',
          textAlign: 'center'
        }}>
          <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px'
            }}>
              <AlertTriangle size={32} style={{ color: 'var(--danger, #ef4444)' }} />
            </div>
            
            <h2 style={{ margin: '0 0 12px 0', fontSize: '20px', fontFamily: 'var(--font-title, sans-serif)' }}>Something went wrong</h2>
            <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary, #64748b)', fontSize: '14px', lineHeight: '1.5' }}>
              We've encountered an unexpected error while loading this page. 
            </p>
            {this.state.error && (
              <div style={{
                margin: '0 0 20px 0',
                padding: '10px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                color: 'var(--danger, #ef4444)',
                fontSize: '12px',
                fontFamily: 'monospace',
                wordBreak: 'break-word',
                textAlign: 'left',
                width: '100%',
                maxHeight: '120px',
                overflowY: 'auto'
              }}>
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <button 
              className="btn btn-primary" 
              onClick={this.handleReload}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center' }}
            >
              <RefreshCcw size={16} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
