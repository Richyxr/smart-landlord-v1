import React, { useEffect, useState } from 'react';

const DISMISS_KEY = 'smart_landlord_install_prompt_dismissed';

const isMobileBrowser = () => {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  return isMobile && !isStandalone;
};

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const alreadyDismissed = localStorage.getItem(DISMISS_KEY);
    if (alreadyDismissed === 'true') {
      setDismissed(true);
      return;
    }

    if (isMobileBrowser()) {
      const timer = window.setTimeout(() => {
        setVisible(true);
      }, 1800);

      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);

      if (isMobileBrowser()) {
        setVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) {
      setShowInstructions(true);
      return;
    }

    installEvent.prompt();

    const choice = await installEvent.userChoice;

    if (choice.outcome === 'accepted') {
      setVisible(false);
      setInstallEvent(null);
      localStorage.setItem(DISMISS_KEY, 'true');
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, 'true');
  };

  if (!visible || dismissed) {
    return null;
  }

  return (
    <div className="install-prompt-backdrop">
      <div className="install-prompt-card">
        <div className="install-prompt-icon-wrap">
          <img
            src="/icons/maskable-512.png"
            alt="Smart Landlord"
            className="install-prompt-icon"
          />
        </div>

        <div className="install-prompt-copy">
          <h3>Install Smart Landlord</h3>
          <p>
            Add Smart Landlord to your phone for faster access, full-screen use,
            and an app-like experience.
          </p>

          {showInstructions && !installEvent && (
            <div className="install-prompt-help">
              <strong>To install:</strong>
              <ol>
                <li>Tap the browser menu <strong>⋮</strong></li>
                <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
                <li>Tap <strong>Install</strong></li>
              </ol>
            </div>
          )}
        </div>

        <div className="install-prompt-actions">
          <button type="button" className="btn btn-primary" onClick={handleInstall}>
            Install App
          </button>

          <button type="button" className="install-prompt-later" onClick={handleDismiss}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
