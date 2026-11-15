import { api } from '@/lib/api-client';

// Browser Web Push enrolment. Registers the service worker, subscribes via the VAPID
// public key, and posts the subscription to the given endpoint. Best-effort.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// Save the app language where the service worker can read it (Cache API), so notifications
// shown while the app is in the background use the driver's language (2026-11-15).
export async function rememberPushLocale(locale: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open('ily-prefs');
    await c.put('/__ily-locale', new Response(locale, { headers: { 'content-type': 'text/plain' } }));
  } catch { /* storage unavailable — the worker falls back to the device language */ }
}

export async function enablePush(subscribeUrl: string): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const cfg = await api<{ enabled: boolean; key: string | null }>('/push/public-key');
    if (!cfg.enabled || !cfg.key) return { ok: false, reason: 'disabled' };
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.key) }));
    await api(subscribeUrl, { method: 'POST', body: { subscription: sub.toJSON() } });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
