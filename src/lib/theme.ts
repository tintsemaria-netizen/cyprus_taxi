'use client';

import { useEffect, useState } from 'react';

// Light / dark theme (2026-11-19).
// - Passengers: follow the browser/system by default, can pick light or dark in their account.
// - Drivers (and staff screens): pick at registration / in the driver menu; default dark.
// The choice is per device (localStorage). An inline script in <head> applies it before first paint,
// so there is no dark→light flash; <html data-theme="light|dark"> drives the CSS colour variables.

import { KEY, DEFAULT, roleForPath, type ThemePref, type Theme, type ThemeRole } from './theme-script';
export type { ThemePref, Theme, ThemeRole } from './theme-script';
export { THEME_SCRIPT } from './theme-script';

export function getThemePref(role: ThemeRole): ThemePref {
  try {
    const v = localStorage.getItem(KEY[role]);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage blocked */ }
  return DEFAULT[role];
}

function systemLight(): boolean {
  try { return matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; }
}

export function resolveTheme(pref: ThemePref): Theme {
  return pref === 'light' || (pref === 'system' && systemLight()) ? 'light' : 'dark';
}

/** Theme currently applied to <html> (for one-off reads, e.g. when a map is created). */
export function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export const THEME_COLOR: Record<Theme, string> = { dark: '#10191C', light: '#F4F6F5' };

/** Apply the stored preference for the current page's role. */
export function applyTheme(): Theme {
  const theme = resolveTheme(getThemePref(roleForPath(location.pathname)));
  const d = document.documentElement;
  if (d.dataset.theme !== theme) d.dataset.theme = theme;
  d.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]));
  return theme;
}

export function setThemePref(role: ThemeRole, pref: ThemePref) {
  try { localStorage.setItem(KEY[role], pref); } catch { /* storage blocked */ }
  applyTheme();
}

/** Current resolved theme; re-renders when <html data-theme> changes. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const d = document.documentElement;
    const read = () => setTheme(d.dataset.theme === 'light' ? 'light' : 'dark');
    read();
    const mo = new MutationObserver(read);
    mo.observe(d, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}
