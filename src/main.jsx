import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { applyThemeMode, getStoredThemeMode } from './lib/themeMode.js';
import { installAuthFetch } from './lib/session.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

installAuthFetch();
applyThemeMode(getStoredThemeMode());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

