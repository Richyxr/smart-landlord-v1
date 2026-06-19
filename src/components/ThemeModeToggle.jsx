import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import {
  THEME_MODES,
  applyThemeMode,
  getStoredThemeMode,
  resolveTheme,
  saveThemeMode,
} from '../lib/themeMode.js';

export default function ThemeModeToggle() {
  const [mode, setMode] = useState(getStoredThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getStoredThemeMode()));

  useEffect(() => {
    applyThemeMode(mode);
    setResolvedTheme(resolveTheme(mode));

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

    const handleSystemThemeChange = () => {
      if (mode === THEME_MODES.SYSTEM) {
        applyThemeMode(THEME_MODES.SYSTEM);
        setResolvedTheme(resolveTheme(THEME_MODES.SYSTEM));
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, [mode]);

  const handleToggle = () => {
    const nextMode =
      resolvedTheme === THEME_MODES.DARK
        ? THEME_MODES.LIGHT
        : THEME_MODES.DARK;

    setMode(nextMode);
    setResolvedTheme(nextMode);
    saveThemeMode(nextMode);
  };

  const isDark = resolvedTheme === THEME_MODES.DARK;

  return (
    <button
      type="button"
      className={`theme-mode-toggle ${isDark ? 'dark' : 'light'}`}
      onClick={handleToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="theme-mode-icon" size={18} strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Moon className="theme-mode-icon" size={18} strokeWidth={2.4} aria-hidden="true" />
      )}
    </button>
  );
}
