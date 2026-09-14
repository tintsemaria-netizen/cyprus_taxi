import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { deliverToAudience } from '@/server/push';

// Durable notification delivery (Task 013, hardened for Task 016 §4). Rows are ENQUEUED
// inside domain transactions. A worker CLAIMS due rows with a lease (FOR UPDATE SKIP LOCKED)
// so two workers never double-process the same row, does the external POST OUTSIDE the claim,
// then records a precise terminal outcome. "Accepted by provider" (SENT_TO_PROVIDER) is never
// conflated with "nobody subscribed" (NO_SUBSCRIBERS), "gave up" (FAILED) or a stale offer
// that must not be delivered (SUPERSEDED). External delivery is at-least-once, not exactly-once.

const MAX_ATTEMPTS = 6;
const BACKOFF_SEC = [5, 15, 60, 300, 900, 1800];
const LEASE_MS = 30_000;

type Db = Prisma.TransactionClient | typeof prisma;

export interface EnqueueInput {
  audience: string;
  title: string;
  body: string;
  url: string;
  tag?: string | null;
  offerId?: string | null; // bind an 'offer' notification to the exact DriverOffer
  dedupeKey?: string | null;
}

// Enqueue in the caller's transaction. A duplicate dedupeKey is skipped WITHOUT poisoning the
// transaction: we probe first, and treat a P2002 as a no-op only as a last-resort race guard.
export async function enqueue(db: Db, n: EnqueueInput): Promise<void> {
  if (n.dedupeKey) {
    const existing = await db.notificationOutbox.findUnique({ where: { dedupeKey: n.dedupeKey }, select: { id: true } });
    if (existing) return;
  }
  try {
    await db.notificationOutbox.create({
      data: { audience: n.audience, title: n.title, body: n.body, url: n.url, tag: n.tag ?? null, offerId: n.offerId ?? null, dedupeKey: n.dedupeKey ?? null, status: 'PENDING' },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // duplicate dedupeKey
    throw e;
  }
}

interface OutboxRow {
  id: string; audience: string; title: string; body: string; url: string;
  tag: string | null; offerId: string | null; attempts: number;
}

// Claim up to `batch` due rows atomically. FOR UPDATE SKIP LOCKED means a second worker
// draining concurrently claims a DISJOINT set — no double delivery of the same row.
async function claimDue(owner: string, token: string, now: Date, batch: number): Promise<OutboxRow[]> {
  return prisma.$queryRaw<OutboxRow[]>`
    UPDATE "NotificationOutbox" AS o
    SET status = 'PROCESSING', "leaseOwner" = ${owner}, "leaseToken" = ${token},
        "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = now()
    WHERE o.id IN (
      SELECT id FROM "NotificationOutbox"
      WHERE status IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    )
    RETURNING o.id, o.audience, o.title, o.body, o.url, o.tag, o."offerId", o.attempts`;
}

async function finalize(id: string, token: string, data: Prisma.NotificationOutboxUpdateManyMutationInput): Promise<void> {
  // Guard by leaseToken so a reclaimed/expired lease cannot overwrite a newer worker's result.
  await prisma.notificationOutbox.updateMany({ where: { id, leaseToken: token }, data: { ...data, leaseOwner: null, leaseToken: null, leaseUntil: null, updatedAt: new Date() } });
}

export async function drainOutbox(now: Date = new Date(), batch = 50): Promise<{ claimed: number }> {
  // Reclaim leases from crashed workers first: PROCESSING past its lease → retry now.
  await prisma.notificationOutbox.updateMany({
    where: { status: 'PROCESSING', leaseUntil: { lt: now } },
    data: { status: 'RETRY', nextAttemptAt: now, leaseOwner: null, leaseToken: null, leaseUntil: null },
  });

  const owner = `outbox-${process.pid}`;
  const token = randomUUID();
  const rows = await claimDue(owner, token, now, batch);

  for (const r of rows) {
    try {
      // Never deliver a stale/expired OFFER as actionable. With offerId we check the exact
      // offer; older rows (no offerId) fall back to "any live offer for this driver".
      if (r.tag === 'offer') {
        const live = await offerStillLive(r);
        if (!live) { await finalize(r.id, token, { status: 'SUPERSEDED', deliveredAt: now }); continue; }
      }
      const res = await deliverToAudience(r.audience, { title: r.title, body: r.body, url: r.url, tag: r.tag ?? undefined });
      if (res.failed === 0) {
        await finalize(r.id, token, { status: res.sent > 0 ? 'SENT_TO_PROVIDER' : 'NO_SUBSCRIBERS', deliveredAt: now });
      } else {
        const attempts = r.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await finalize(r.id, token, { status: 'FAILED', attempts, deliveredAt: now, lastError: `delivery failed after ${attempts} attempts` });
        } else {
          const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
          await finalize(r.id, token, { status: 'RETRY', attempts, nextAttemptAt: new Date(now.getTime() + backoff), lastError: `${res.failed} push endpoint(s) failed` });
        }
      }
    } catch (e) {
      // Isolate a single bad row; return it to RETRY so it is not stuck in PROCESSING.
      const attempts = r.attempts + 1;
      const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
      await finalize(r.id, token, attempts >= MAX_ATTEMPTS
        ? { status: 'FAILED', attempts, deliveredAt: now, lastError: 'exception during delivery' }
        : { status: 'RETRY', attempts, nextAttemptAt: new Date(now.getTime() + backoff), lastError: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return { claimed: rows.length };
}

async function offerStillLive(r: OutboxRow): Promise<boolean> {
  const nowD = new Date();
  if (r.offerId) {
    const o = await prisma.driverOffer.findUnique({ where: { id: r.offerId }, select: { status: true, expiresAt: true } });
    return !!o && o.status === 'OFFERED' && o.expiresAt > nowD;
  }
  // Legacy rows without offerId: is there ANY live offer for this driver?
  if (!r.audience.startsWith('DRIVER:')) return true;
  const driver = await prisma.driver.findFirst({ where: { userId: r.audience.slice(7) }, select: { id: true } });
  if (!driver) return false;
  const live = await prisma.driverOffer.findFirst({ where: { activeDriverId: driver.id, status: 'OFFERED', expiresAt: { gt: nowD } }, select: { id: true } });
  return !!live;
}
