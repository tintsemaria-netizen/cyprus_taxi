import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { deliverToAudience } from '@/server/push';

// Durable notification delivery (Task 013). Enqueue inside domain writes; drain with
// retries + backoff. Never re-send (dedupeKey) and never deliver a stale offer.

const MAX_ATTEMPTS = 6;
const BACKOFF_SEC = [5, 15, 60, 300, 900, 1800];

type Db = Prisma.TransactionClient | typeof prisma;

export async function enqueue(db: Db, n: { audience: string; title: string; body: string; url: string; tag?: string | null; dedupeKey?: string | null }): Promise<void> {
  try {
    await db.notificationOutbox.create({ data: { audience: n.audience, title: n.title, body: n.body, url: n.url, tag: n.tag ?? null, dedupeKey: n.dedupeKey ?? null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // duplicate dedupeKey → already queued
    throw e;
  }
}

export async function drainOutbox(now: Date = new Date()): Promise<void> {
  const rows = await prisma.notificationOutbox.findMany({ where: { deliveredAt: null, nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 50 });
  for (const r of rows) {
    // Never deliver a stale/expired OFFER as actionable.
    if (r.tag === 'offer' && r.audience.startsWith('DRIVER:')) {
      const driver = await prisma.driver.findFirst({ where: { userId: r.audience.slice(7) }, select: { id: true } });
      const live = driver ? await prisma.driverOffer.findFirst({ where: { activeDriverId: driver.id, status: 'OFFERED', expiresAt: { gt: new Date() } } }) : null;
      if (!live) { await prisma.notificationOutbox.update({ where: { id: r.id }, data: { deliveredAt: new Date() } }); continue; }
    }
    const res = await deliverToAudience(r.audience, { title: r.title, body: r.body, url: r.url, tag: r.tag ?? undefined });
    if (res.failed === 0) {
      await prisma.notificationOutbox.update({ where: { id: r.id }, data: { deliveredAt: new Date() } }); // delivered (or nobody subscribed)
    } else {
      const attempts = r.attempts + 1;
      const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
      await prisma.notificationOutbox.update({
        where: { id: r.id },
        data: { attempts, nextAttemptAt: new Date(Date.now() + backoff), ...(attempts >= MAX_ATTEMPTS ? { deliveredAt: new Date() } : {}) }, // give up after MAX_ATTEMPTS
      });
    }
  }
}
