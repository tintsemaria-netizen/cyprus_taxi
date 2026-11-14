// In-app navigation trail for the passenger back arrow (2026-11-14).
//
// The back arrow must go exactly one step back inside the app — not always to the home screen.
// document.referrer is unreliable (no-referrer on some pages), so every passenger page records
// its URL in a small per-tab stack in sessionStorage. Back pops the stack and uses history.back()
// when the previous entry is ours; otherwise (deep link, new tab) it goes to a fallback page.
//
// If the user left a page through the account menu, going back to that page reopens the menu
// (the menu was the step they came from).

const KEY = 'ily-trail';
const MENU_FROM = 'ily-menu-from';
const MENU_REOPEN = 'ily-menu-reopen';

const here = () => window.location.pathname + window.location.search;

function read(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(s: string[]) { try { sessionStorage.setItem(KEY, JSON.stringify(s.slice(-30))); } catch { /* storage off */ } }

/** Call on every passenger page mount (and on bfcache restore). */
export function recordVisit(): void {
  const s = read();
  if (s[s.length - 1] !== here()) { s.push(here()); write(s); }
}

/** One step back inside the app, or to `fallback` when there is no in-app history. */
export function goBack(fallback: string): void {
  const s = read();
  if (s.length >= 2 && s[s.length - 1] === here()) {
    s.pop();
    write(s);
    try { if (sessionStorage.getItem(MENU_FROM) === s[s.length - 1]) sessionStorage.setItem(MENU_REOPEN, '1'); } catch { /* ignore */ }
    window.history.back();
    return;
  }
  window.location.href = fallback;
}

/** The account menu calls this when the user picks an item (leaves this page via the menu). */
export function markLeftViaMenu(): void { try { sessionStorage.setItem(MENU_FROM, here()); } catch { /* ignore */ } }

/** True once if we just came back to the page the menu was used on → reopen the menu. */
export function consumeMenuReopen(): boolean {
  try {
    if (sessionStorage.getItem(MENU_REOPEN) === '1' && sessionStorage.getItem(MENU_FROM) === here()) {
      sessionStorage.removeItem(MENU_REOPEN);
      sessionStorage.removeItem(MENU_FROM);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
