import webpush from 'web-push';
import { Prisma } from '@prisma/client';
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

export interface PushPayload { title: string; body: string; url: string; tag?: string }

// Actually POST to every device subscription for an audience. Returns delivered/failed
// counts so the outbox can decide whether to retry. Prunes gone (404/410) subscriptions.
export async function deliverToAudience(audience: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!ensureVapid()) return { sent: 0, failed: 0 };
  const subs = await prisma.pushSubscription.findMany({ where: { audience } });
  let sent = 0, failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }); // gone → prune, not a retryable failure
        else failed++;
      }
    }),
  );
  return { sent, failed };
}

// The enqueue* helpers write to the durable outbox INSIDE the caller's transaction (Task 016
// §4): a committed transition therefore always has its notification job (no fire-and-forget
// gap), and a rollback removes it. A dedicated worker drains with retries/backoff and drops
// stale offers, so a transition is never silently un-notified and a duplicate is never re-sent.
type Db = Prisma.TransactionClient | typeof prisma;

export async function enqueuePassenger(db: Db, bookingId: string, title: string, body: string, opts?: { url?: string; tag?: string; dedupeKey?: string }): Promise<void> {
  const { enqueue } = await import('@/server/outbox');
  await enqueue(db, { audience: `PASSENGER:${bookingId}`, title, body, url: opts?.url ?? '/track', tag: opts?.tag ?? `ride-${bookingId}`, dedupeKey: opts?.dedupeKey });
}
export async function enqueueDriver(db: Db, driverId: string, title: string, body: string, opts?: { tag?: string; url?: string; offerId?: string | null; dedupeKey?: string }): Promise<void> {
  const d = await db.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (!d) return;
  const { enqueue } = await import('@/server/outbox');
  await enqueue(db, { audience: `DRIVER:${d.userId}`, title, body, url: opts?.url ?? '/driver', tag: opts?.tag ?? 'ride', offerId: opts?.offerId ?? null, dedupeKey: opts?.dedupeKey });
}
// Build the offer-notification body from a pickup label + ETA (no passenger PII).
export function offerBody(pickupLabel: string | null | undefined, pickupEtaSec?: number | null): string {
  const etaMin = pickupEtaSec != null ? Math.max(1, Math.round(pickupEtaSec / 60)) : null;
  return `${pickupLabel ?? 'Pickup nearby'}${etaMin != null ? ` · ~${etaMin} min away` : ''} — tap to accept`;
}

export async function notifyNewMessage(bookingId: string, sender: 'PASSENGER' | 'DRIVER', snippet: string): Promise<void> {
  const body = snippet.length > 120 ? snippet.slice(0, 117) + '…' : snippet;
  const { enqueue } = await import('@/server/outbox');
  if (sender === 'DRIVER') {
    await enqueue(prisma, { audience: `PASSENGER:${bookingId}`, title: 'Message from your driver', body, url: '/track', tag: `chat-${bookingId}` });
  } else {
    const a = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });
    if (!a) return;
    const d = await prisma.driver.findUnique({ where: { id: a.driverId }, select: { userId: true } });
    if (d) await enqueue(prisma, { audience: `DRIVER:${d.userId}`, title: 'Message from your passenger', body, url: '/driver', tag: `chat-${bookingId}` });
  }
}
