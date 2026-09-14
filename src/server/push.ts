import webpush from 'web-push';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';

// Web Push (VAPID). Notifications SUPPLEMENT the in-app polling; they are best-effort and
// not a source of truth. iOS requires the site be installed to the Home Screen (PWA).

let vapidReady = false;
function ensureVapid(): boolean {
  if (!config.push.enabled) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(config.push.vapidSubject, config.push.vapidPublic, config.push.vapidPrivate());
    vapidReady = true;
  }
  return true;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const MAX_SUBS_PER_AUDIENCE = 10;

// SSRF guard: web-push POSTs to this endpoint, so it must be a public HTTPS push host.
// Reject non-https, bare-IP hosts (blocks loopback/private/link-local/metadata) and
// localhost/.local. Real FCM/Mozilla/Apple endpoints are public domain names.
export function isSafePushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isV6 = host.includes(':') || host.startsWith('[');
  if (isV4 || isV6) return false; // never allow an IP-literal destination
  return true;
}

function validKeys(k: { p256dh?: string; auth?: string }): boolean {
  const okStr = (s?: string, max = 512) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9_\-=]+$/.test(s);
  return okStr(k.p256dh) && okStr(k.auth, 256);
}

export async function saveSubscription(audience: string, sub: BrowserSubscription): Promise<boolean> {
  if (!sub?.endpoint || sub.endpoint.length > 2048 || !isSafePushEndpoint(sub.endpoint)) return false;
  if (!sub.keys || !validKeys(sub.keys)) return false;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { audience, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: { endpoint: sub.endpoint, audience, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  // Bound per-audience fan-out: keep only the newest N device subscriptions.
  const subs = await prisma.pushSubscription.findMany({ where: { audience }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (subs.length > MAX_SUBS_PER_AUDIENCE) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: subs.slice(MAX_SUBS_PER_AUDIENCE).map((s) => s.id) } } });
  }
  return true;
}

interface PushPayload { title: string; body: string; url: string; tag?: string }

async function sendToAudience(audience: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { audience } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }); // gone → prune
      }
    }),
  );
}

// Generic best-effort helpers (delivery supplements authoritative state + polling).
export async function notifyPassenger(bookingId: string, title: string, body: string): Promise<void> {
  if (!config.push.enabled) return;
  await sendToAudience(`PASSENGER:${bookingId}`, { title, body, url: '/track', tag: `ride-${bookingId}` });
}
export async function notifyBookingDriver(bookingId: string, title: string, body: string): Promise<void> {
  if (!config.push.enabled) return;
  const a = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
  if (!a) return;
  await notifyDriverByDriverId(a.driverId, title, body);
}
export async function notifyDriverByDriverId(driverId: string, title: string, body: string): Promise<void> {
  if (!config.push.enabled) return;
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (d) await sendToAudience(`DRIVER:${d.userId}`, { title, body, url: '/driver', tag: 'ride' });
}

// Fire-and-forget: notify a driver of a new ride offer reserved for them.
export async function notifyDriverOffer(driverId: string, bookingId: string, pickupEtaSec?: number | null): Promise<void> {
  if (!config.push.enabled) return;
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (!d) return;
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { pickupLabel: true } });
  const etaMin = pickupEtaSec != null ? Math.max(1, Math.round(pickupEtaSec / 60)) : null;
  const body = `${b?.pickupLabel ?? 'Pickup nearby'}${etaMin != null ? ` · ~${etaMin} min away` : ''} — tap to accept`;
  await sendToAudience(`DRIVER:${d.userId}`, { title: 'New ride offer', body, url: '/driver', tag: 'offer' });
}

// Fire-and-forget: notify the OTHER party of a new chat message.
export async function notifyNewMessage(bookingId: string, sender: 'PASSENGER' | 'DRIVER', snippet: string): Promise<void> {
  if (!config.push.enabled) return;
  const body = snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet;
  if (sender === 'DRIVER') {
    await sendToAudience(`PASSENGER:${bookingId}`, { title: 'Message from your driver', body, url: '/track', tag: `chat-${bookingId}` });
  } else {
    const a = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
    if (!a) return;
    const d = await prisma.driver.findUnique({ where: { id: a.driverId }, select: { userId: true } });
    if (!d) return;
    await sendToAudience(`DRIVER:${d.userId}`, { title: 'Message from your passenger', body, url: '/driver', tag: `chat-${bookingId}` });
  }
}
