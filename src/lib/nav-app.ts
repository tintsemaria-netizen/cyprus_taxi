// The driver's outside navigator (operator 2026-11-27): Google Maps or Waze, and whether it opens by itself
// after «Принять» (to the client) and «Начать поездку» / leaving the stop (to the next point). Kept on this
// phone (the navigator app is installed on the phone, not on the account).
export type NavApp = 'google' | 'waze';
export type NavPrefs = { auto: boolean; app: NavApp };
const KEY = 'ily_nav_app';
export const NAV_PREFS_EVENT = 'il-y:nav-prefs';

export function readNavPrefs(): NavPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<NavPrefs>;
    return { auto: v.auto === true, app: v.app === 'waze' ? 'waze' : 'google' };
  } catch { return { auto: false, app: 'google' }; }
}

export function writeNavPrefs(p: NavPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new Event(NAV_PREFS_EVENT)); } catch { /* ignore */ }
}

export function navUrl(app: NavApp, lat: number, lng: number): string {
  return app === 'waze'
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Opens the chosen navigator if the driver switched «automatically» on. Call it right in the tap handler
 *  (before any await): browsers only let a page open another app from a tap. */
export function autoOpenNav(lat: number, lng: number): void {
  const p = readNavPrefs();
  if (!p.auto) return;
  try { window.open(navUrl(p.app, lat, lng), '_blank', 'noopener'); } catch { /* blocked */ }
}
