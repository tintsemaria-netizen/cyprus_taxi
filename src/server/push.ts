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

export async function saveSubscription(audience: string, sub: BrowserSubscription): Promise<boolean> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { audience, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: { endpoint: sub.endpoint, audience, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
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
