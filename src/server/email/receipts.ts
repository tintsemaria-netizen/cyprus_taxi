// E-mailed trip receipts (2026-11-17): enqueue in the completion transaction, deliver from the
// background worker, let the passenger ask for another copy. Same outbox discipline as push:
// rows are claimed with FOR UPDATE SKIP LOCKED + a lease, the HTTP call happens outside any
// transaction, and a lease token guards the final write.
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings, reviewLink } from '@/lib/settings';
import { asLocale } from '@/i18n/translate';
import { buildReceipt, RECEIPT_RESEND_MAX } from '@/server/receipt';
import { emailConfigured, sendEmail } from './provider';
import { receiptEmail } from './receipt-template';
import { isFixedPrice } from '@/lib/price-type';

type Db = Prisma.TransactionClient | typeof prisma;

const MAX_ATTEMPTS = 6;

/** Receipts go out in Russian or English only (owner, 2026-11-17): Russian for a Russian app, else English. */
export function receiptLocale(v: unknown): 'ru' | 'en' {
  return asLocale(v) === 'ru' ? 'ru' : 'en';
}
const BACKOFF_SEC = [30, 120, 600, 1800, 3600, 7200];
const LEASE_MS = 60_000;
/** A receipt that could not go out for this long (e.g. no provider yet) is dropped, not sent late. */
const STALE_MS = 7 * 24 * 3600_000;

/** Called inside the completion transaction. No e-mail on the account → nothing queued. */
export async function enqueueReceiptEmail(db: Db, bookingId: string): Promise<void> {
  const b = await db.booking.findUnique({ where: { id: bookingId }, select: { passengerId: true } });
  if (!b?.passengerId) return;
  const p = await db.passenger.findUnique({ where: { id: b.passengerId }, select: { email: true, locale: true } });
  if (!p?.email) return;
  const exists = await db.receiptEmail.findUnique({ where: { bookingId }, select: { id: true } });
  if (exists) return;
  // Launch fixes §6: a meter ride's real amount comes from the driver after completion. Hold the
  // e-mail up to METER_HOLD_MS so it carries that amount; entering it releases the e-mail at once
  // (releaseReceiptEmail). If the driver never enters it, the e-mail goes with «≈ estimate».
  const fare = await db.fare.findUnique({ where: { bookingId }, select: { priceType: true } });
  const hold = fare && !isFixedPrice(fare.priceType) ? new Date(Date.now() + METER_HOLD_MS) : new Date();
  await db.receiptEmail.create({ data: { bookingId, passengerId: b.passengerId, toEmail: p.email, locale: receiptLocale(p.locale), nextAttemptAt: hold } });
}

export const METER_HOLD_MS = 20 * 60_000;
/** The driver entered the taximeter amount → send the held receipt e-mail now (inside his transaction). */
export async function releaseReceiptEmail(db: Db, bookingId: string): Promise<void> {
  await db.receiptEmail.updateMany({ where: { bookingId, status: 'PENDING', sentAt: null }, data: { nextAttemptAt: new Date() } });
}

export type ResendResult = { ok: true; status: string } | { ok: false; status: number; code: string; message: string };

/** Passenger «send to e-mail» / «send again». */
export async function requestReceiptEmail(bookingId: string, passengerId: string): Promise<ResendResult> {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, passengerId }, select: { status: true } });
  if (!b) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Ride not found.' };
  if (b.status !== 'COMPLETED') return { ok: false, status: 409, code: 'NO_RECEIPT', message: 'A receipt is available only after the ride is completed.' };
  const p = await prisma.passenger.findUnique({ where: { id: passengerId }, select: { email: true, locale: true } });
  if (!p?.email) return { ok: false, status: 409, code: 'NO_EMAIL', message: 'There is no e-mail address on your account.' };
  const row = await prisma.receiptEmail.findUnique({ where: { bookingId } });
  if (!row) {
    await prisma.receiptEmail.create({ data: { bookingId, passengerId, toEmail: p.email, locale: receiptLocale(p.locale) } });
    return { ok: true, status: 'PENDING' };
  }
  if (row.status === 'PROCESSING' || row.status === 'PENDING' || row.status === 'RETRY') return { ok: true, status: row.status };
  if (row.resendCount >= RECEIPT_RESEND_MAX) return { ok: false, status: 429, code: 'RESEND_LIMIT', message: 'This receipt was already sent several times.' };
  await prisma.receiptEmail.update({
    where: { id: row.id },
    data: { status: 'PENDING', attempts: 0, resendCount: { increment: 1 }, nextAttemptAt: new Date(), toEmail: p.email, locale: receiptLocale(p.locale), lastError: null },
  });
  return { ok: true, status: 'PENDING' };
}

interface Row { id: string; bookingId: string; toEmail: string; locale: string; attempts: number; resendCount: number; nextAttemptAt: Date }

export async function drainReceiptEmails(now: Date = new Date(), batch = 20): Promise<{ claimed: number; configured: boolean }> {
  // Crashed worker: PROCESSING past its lease → retry now.
  await prisma.receiptEmail.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lt: now } }, data: { status: 'RETRY', nextAttemptAt: now, leaseToken: null, leaseUntil: null } });
  // Too old to be useful.
  await prisma.receiptEmail.updateMany({ where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lt: new Date(now.getTime() - STALE_MS) } }, data: { status: 'SKIPPED', lastError: 'stale' } });
  // Launch fixes §3: without a provider, due e-mails are closed as SKIPPED («no-provider») instead of
  // piling up — turning e-mail on later must not blast a backlog of old receipts. The passenger can
  // still ask for the copy from the receipt screen.
  if (!emailConfigured()) {
    await prisma.receiptEmail.updateMany({ where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: now } }, data: { status: 'SKIPPED', lastError: 'no-provider' } });
    return { claimed: 0, configured: false };
  }

  const token = randomUUID();
  const rows = await prisma.$queryRaw<Row[]>`
    UPDATE "ReceiptEmail" AS r
    SET status = 'PROCESSING', "leaseToken" = ${token}, "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = now()
    WHERE r.id IN (
      SELECT id FROM "ReceiptEmail"
      WHERE status IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batch}
    )
    RETURNING r.id, r."bookingId", r."toEmail", r.locale, r.attempts, r."resendCount", r."nextAttemptAt"`;

  const reviewUrl = reviewLink((await getSettings()).googleReviewUrl);
  const done = (id: string, data: Prisma.ReceiptEmailUpdateManyMutationInput) =>
    prisma.receiptEmail.updateMany({ where: { id, leaseToken: token }, data: { ...data, leaseToken: null, leaseUntil: null } });

  for (const r of rows) {
    const built = await buildReceipt(r.bookingId);
    if (!built.ok) { await done(r.id, { status: 'SKIPPED', lastError: built.code }); continue; }
    const locale = receiptLocale(r.locale);
    const mail = receiptEmail(built.receipt, locale, `${config.appBaseUrl}/rides/${r.bookingId}`, reviewUrl);
    const res = await sendEmail({ to: r.toEmail, ...mail, idempotencyKey: `receipt-${r.bookingId}-${r.resendCount}` });
    if (res.ok) { await done(r.id, { status: 'SENT', sentAt: now, providerMessageId: res.id, lastError: null }); continue; }
    const attempts = r.attempts + 1;
    if (!res.retry || attempts >= MAX_ATTEMPTS) {
      await done(r.id, { status: 'FAILED', attempts, lastError: res.error });
      console.warn(`[receipt-email] failed for booking ${r.bookingId}: ${res.error}`);
    } else {
      const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
      await done(r.id, { status: 'RETRY', attempts, nextAttemptAt: new Date(now.getTime() + backoff), lastError: res.error });
    }
  }
  return { claimed: rows.length, configured: true };
}
