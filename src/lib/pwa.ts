// Home-screen install helpers (PWA). Client-only; every function is safe to call during SSR
// (returns the "not installable / unknown" answer).

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome on Android fires `beforeinstallprompt` once, early in page load — possibly before the
// React component that offers "Install" has mounted. Capture it at module load and hand it over.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l(deferred));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l(null));
  });
}

export function onInstallPrompt(cb: (e: BeforeInstallPromptEvent | null) => void): () => void {
  listeners.add(cb);
  cb(deferred);
  return () => { listeners.delete(cb); };
}

export function clearInstallPrompt() {
  deferred = null;
  listeners.forEach((l) => l(null));
}

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
}

const DISMISS_DAYS = 14;
const dismissKey = (app: string) => `ily.install.dismissed.${app}`;

export function installDismissed(app: string): boolean {
  try {
    const v = Number(localStorage.getItem(dismissKey(app)));
    return Number.isFinite(v) && v > 0 && Date.now() - v < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function dismissInstall(app: string) {
  try { localStorage.setItem(dismissKey(app), String(Date.now())); } catch { /* storage unavailable */ }
}
