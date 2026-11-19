// Theme constants + the pre-paint <head> script (2026-11-19). No React here: imported by the root layout
// (a Server Component). Hooks and helpers live in theme.ts.

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export type ThemeRole = 'passenger' | 'driver';

export const KEY: Record<ThemeRole, string> = { passenger: 'il-y-theme', driver: 'il-y-theme-d' };
export const DEFAULT: Record<ThemeRole, ThemePref> = { passenger: 'system', driver: 'dark' };
export const STAFF_PATH = /^\/(driver|staff|admin|dispatch)(\/|$)/;

export function roleForPath(path: string): ThemeRole {
  return STAFF_PATH.test(path) ? 'driver' : 'passenger';
}

/** Runs inline in <head> before paint. Keep in sync with resolveTheme(). */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,s=/^\\/(driver|staff|admin|dispatch)(\\/|$)/.test(location.pathname);var v=localStorage.getItem(s?'${KEY.driver}':'${KEY.passenger}')||(s?'${DEFAULT.driver}':'${DEFAULT.passenger}');var l=v==='light'||(v==='system'&&matchMedia('(prefers-color-scheme: light)').matches);d.dataset.theme=l?'light':'dark';d.style.colorScheme=l?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

