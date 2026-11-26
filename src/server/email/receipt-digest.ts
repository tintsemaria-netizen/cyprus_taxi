// Weekly / monthly receipt summary (2026-11-26, operator). A passenger chooses in Profile settings →
// Receipts: one e-mail per ride (default), a weekly or a monthly summary, or no e-mails. The summary
// lists the rides of the PREVIOUS full Cyprus week (Mon–Sun) or month and goes out from 08:00 the
// next day. Only rides completed after the passenger chose the mode are listed, so a ride is never
// e-mailed twice. Delivery uses the same outbox discipline as single receipts.
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { nicosiaDayKey, nicosiaMidnightUtc, startOfNicosiaDay } from '@/lib/timezone';
import { buildReceipt } from '@/server/receipt';
import { emailConfigured, sendEmail } from './provider';
import { receiptLocale } from './receipts';
import { receiptDigestEmail, type DigestRide } from './receipt-template';

export const RECEIPT_MODES = ['EACH', 'WEEKLY', 'MONTHLY', 'OFF'] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];
export const isReceiptMode = (v: unknown): v is ReceiptMode => typeof v === 'string' && (RECEIPT_MODES as readonly string[]).includes(v);

const SEND_FROM_HOUR = 8; // the summary goes out from 08:00 Cyprus time on the first day after the period
const MAX_ATTEMPTS = 6;
const BACKOFF_SEC = [30, 120, 600, 1800, 3600, 7200];
const LEASE_MS = 60_000;
const STALE_MS = 7 * 24 * 3600_000;

/** The last FULL period before `now` (Cyprus calendar): previous Mon–Sun week or previous month. */
export function previousPeriod(period: 'WEEKLY' | 'MONTHLY', now: Date): { start: Date; end: Date } {
  if (period === 'WEEKLY') {
    const [y, m, d] = nicosiaDayKey(now).split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon = 0
    const end = startOfNicosiaDay(now, -dow);
    return { start: startOfNicosiaDay(end, -7), end };
  }
  const [y, m] = nicosiaDayKey(now).split('-').map(Number);
  const p = (n: number) => String(n).padStart(2, '0');
  const end = nicosiaMidnightUtc(`${y}-${p(m)}-01`);
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  return { start: nicosiaMidnightUtc(`${py}-${p(pm)}-01`), end };
}

/** Queue the due summaries. Cheap and idempotent (unique passenger + period + start); run from maintenance. */
export async function scheduleReceiptDigests(now: Date = new Date()): Promise<number> {
  const people = await prisma.passenger.findMany({
    where: { receiptMode: { in: ['WEEKLY', 'MONTHLY'] }, email: { not: null } },
    select: { id: true, email: true, locale: true, receiptMode: true, receiptModeSince: true },
  });
  let queued = 0;
  for (const p of people) {
    const period = p.receiptMode as 'WEEKLY' | 'MONTHLY';
    const { start, end } = previousPeriod(period, now);
    if (now.getTime() < end.getTime() + SEND_FROM_HOUR * 3600_000) continue;
    const from = p.receiptModeSince && p.receiptModeSince > start ? p.receiptModeSince : start;
    if (from >= end) continue;
    const exists = await prisma.receiptDigest.findUnique({ where: { passengerId_period_periodStart: { passengerId: p.id, period, periodStart: start } }, select: { id: true } });
    if (exists) continue;
    const done = await prisma.bookingEvent.findMany({
      where: { type: 'COMPLETED', createdAt: { gte: from, lt: end }, booking: { passengerId: p.id, status: 'COMPLETED' } },
      orderBy: { createdAt: 'asc' }, select: { bookingId: true },
    });
    const ids = [...new Set(done.map((e) => e.bookingId))];
    if (!ids.length) continue;
    const r = await prisma.receiptDigest.createMany({
      data: [{ passengerId: p.id, period, periodStart: start, periodEnd: end, toEmail: p.email!, locale: receiptLocale(p.locale), bookingIds: ids, nextAttemptAt: now }],
      skipDuplicates: true,
    });
    queued += r.count;
  }
  return queued;
}

interface Row { id: string; passengerId: string; period: string; periodStart: Date; periodEnd: Date; toEmail: string; locale: string; bookingIds: string[]; attempts: number }

export async function drainReceiptDigests(now: Date = new Date(), batch = 10): Promise<{ claimed: number; configured: boolean }> {
  await prisma.receiptDigest.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lt: now } }, data: { status: 'RETRY', nextAttemptAt: now, leaseToken: null, leaseUntil: null } });
  await prisma.receiptDigest.updateMany({ where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { status: 'SKIPPED', lastError: 'stale' } });
  if (!emailConfigured()) return { claimed: 0, configured: false };
  const token = randomUUID();
  const rows = await prisma.$queryRaw<Row[]>`
    UPDATE "ReceiptDigest" AS r
    SET status = 'PROCESSING', "leaseToken" = ${token}, "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = now()
    WHERE r.id IN (
      SELECT id FROM "ReceiptDigest"
      WHERE status IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    )
    RETURNING r.id, r."passengerId", r.period, r."periodStart", r."periodEnd", r."toEmail", r.locale, r."bookingIds", r.attempts`;
  const done = (id: string, data: Prisma.ReceiptDigestUpdateManyMutationInput) =>
    prisma.receiptDigest.updateMany({ where: { id, leaseToken: token }, data: { ...data, leaseToken: null, leaseUntil: null } });

  for (const r of rows) {
    // The passenger may have switched back to per-ride / off, or removed the e-mail, since it was queued.
    const p = await prisma.passenger.findUnique({ where: { id: r.passengerId }, select: { receiptMode: true, email: true } });
    if (!p?.email || p.receiptMode !== r.period) { await done(r.id, { status: 'SKIPPED', lastError: 'mode-changed' }); continue; }
    const rides: DigestRide[] = [];
    for (const id of r.bookingIds) {
      const b = await buildReceipt(id, r.passengerId);
      if (b.ok) rides.push({ completedAt: b.receipt.completedAt, pickup: b.receipt.pickup, dropoff: b.receipt.dropoff, totalCents: b.receipt.fare.totalCents, currency: b.receipt.fare.currency, reference: b.receipt.reference });
    }
    if (!rides.length) { await done(r.id, { status: 'SKIPPED', lastError: 'no-rides' }); continue; }
    const mail = receiptDigestEmail(rides, receiptLocale(r.locale), r.period as 'WEEKLY' | 'MONTHLY', r.periodStart, new Date(r.periodEnd.getTime() - 1), `${config.appBaseUrl}/account#receipts`);
    const res = await sendEmail({ to: p.email, ...mail, idempotencyKey: `receipt-digest-${r.id}` });
    if (res.ok) { await done(r.id, { status: 'SENT', sentAt: now, providerMessageId: res.id, lastError: null }); continue; }
    const attempts = r.attempts + 1;
    if (!res.retry || attempts >= MAX_ATTEMPTS) {
      await done(r.id, { status: 'FAILED', attempts, lastError: res.error });
      console.warn(`[receipt-digest] failed for ${r.id}: ${res.error}`);
    } else {
      const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
      await done(r.id, { status: 'RETRY', attempts, nextAttemptAt: new Date(now.getTime() + backoff), lastError: res.error });
    }
  }
  return { claimed: rows.length, configured: true };
}
