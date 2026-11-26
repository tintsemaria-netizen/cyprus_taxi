import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { completedTotalCents } from '@/lib/fare-total';
import { isReceiptMode } from '@/server/email/receipt-digest';

export const dynamic = 'force-dynamic';
const PAGE = 30;

// Passenger «Receipts» in Profile settings (2026-11-26): every completed ride with its receipt, newest
// first (30 at a time, `?before=<ISO>` for more), plus how receipts are e-mailed.
export async function GET(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const beforeRaw = new URL(req.url).searchParams.get('before');
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id, status: 'COMPLETED', ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' }, take: PAGE + 1,
    select: { id: true, reference: true, createdAt: true, pickupLabel: true, dropoffLabel: true, fareCents: true, priceType: true, fare: { select: { estimateCents: true, waitingCents: true, finalCents: true, currency: true } } },
  });
  const page = rows.slice(0, PAGE);
  const ids = page.map((b) => b.id);
  const [events, corrections, mails] = await Promise.all([
    prisma.bookingEvent.findMany({ where: { bookingId: { in: ids }, type: 'COMPLETED' }, select: { bookingId: true, createdAt: true } }),
    prisma.driverSettlement.findMany({ where: { bookingId: { in: ids } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true } }),
    prisma.receiptEmail.findMany({ where: { bookingId: { in: ids } }, select: { bookingId: true, status: true } }),
  ]);
  const doneAt = new Map(events.map((e) => [e.bookingId, e.createdAt]));
  const corr = new Map(corrections.map((s) => [s.bookingId, s.reportedFinalCents]));
  const mailed = new Map(mails.map((m) => [m.bookingId, m.status]));
  return apiOk({
    mode: p.receiptMode,
    email: p.email,
    receipts: page.map((b) => ({
      id: b.id, reference: b.reference,
      at: (doneAt.get(b.id) ?? b.createdAt).toISOString(),
      pickup: b.pickupLabel, dropoff: b.dropoffLabel,
      totalCents: b.fare ? completedTotalCents({ ...b.fare, priceType: b.priceType }, corr.get(b.id)) : b.fareCents,
      currency: b.fare?.currency ?? 'EUR',
      emailed: mailed.get(b.id) === 'SENT',
    })),
    nextBefore: rows.length > PAGE ? page[page.length - 1].createdAt.toISOString() : null,
  });
}

// Change how receipts are e-mailed: EACH | WEEKLY | MONTHLY | OFF.
export async function PATCH(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  let body: { mode?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!isReceiptMode(body.mode)) return Errors.validation({ mode: 'Choose EACH, WEEKLY, MONTHLY or OFF.' });
  if (body.mode !== p.receiptMode) {
    await prisma.passenger.update({ where: { id: p.id }, data: { receiptMode: body.mode, receiptModeSince: new Date() } });
  }
  return apiOk({ mode: body.mode });
}
