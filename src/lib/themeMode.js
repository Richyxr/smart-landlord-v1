export const THEME_STORAGE_KEY = 'smart_landlord_theme_mode';

export const THEME_MODES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
};

export function getStoredThemeMode() {
  if (typeof window === 'undefined') {
    return THEME_MODES.SYSTEM;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

  if ([THEME_MODES.LIGHT, THEME_MODES.DARK, THEME_MODES.SYSTEM].includes(stored)) {
    return stored;
  }

  return THEME_MODES.SYSTEM;
}

export function getSystemTheme() {
  if (typeof window === 'undefined') {
    return THEME_MODES.DARK;
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? THEME_MODES.LIGHT
    : THEME_MODES.DARK;
}

export function resolveTheme(mode) {
  if (mode === THEME_MODES.SYSTEM) {
    return getSystemTheme();
  }

  return mode;
}

export function applyThemeMode(mode) {
  if (typeof document === 'undefined') {
    return;
  }

  const resolvedTheme = resolveTheme(mode);

  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function saveThemeMode(mode) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyThemeMode(mode);
}
