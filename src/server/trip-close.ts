import { prisma } from '@/lib/db';
import { meterWaitingCents } from '@/lib/tariff';
import { isFixedPrice } from '@/lib/price-type';
import { gpsMeterFor } from '@/server/gps-meter';

// Trip close-out for the driver (2026-11-15):
//  1. fare preview before the final «Завершить» — what the completion will record, so the driver
//     can settle questions with the passenger first (estimate + pickup waiting + stop waiting);
//  2. the driver's 1–5 star rating of the passenger afterwards.

export async function farePreview(bookingId: string, driverId: string, now = new Date()) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b) return null;
  const active = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId, driverId } /* a shared ride's second leg has no activeDriverId */, select: { id: true } });
  if (!active) return null;
  const w = await prisma.waitingSession.findUnique({ where: { bookingId } });
  const pickupWaitCents = w?.accruedCents ?? 0;
  const stopWaitCents = b.stopWaitCents ?? (b.stopWaitStartedAt ? meterWaitingCents(b.stopWaitStartedAt, b.stopDepartedAt ?? now) : 0);
  const estimateCents = b.fareCents ?? null;
  const upfront = isFixedPrice(b.priceType);
  return {
    status: b.status,
    currency: 'EUR',
    estimateCents,
    pickupWaitCents,
    stopWaitCents,
    totalCents: (estimateCents ?? 0) + pickupWaitCents + stopWaitCents,
    upfront, // upfront = final; otherwise the regulated meter is final and this is an estimate
    stopLabel: b.stopLabel,
    pickupLabel: b.pickupLabel,
    dropoffLabel: b.dropoffLabel,
    passengerName: b.passengerName,
    // GPS taximeter so far (comparison with the car's meter; not charged).
    gpsMeter: b.status === 'IN_PROGRESS' ? await gpsMeterFor(prisma, bookingId, driverId, now).catch(() => null) : null,
  };
}

export type RatePassengerResult = { ok: true } | { ok: false; status: number; code: string; message: string };

export async function ratePassenger(bookingId: string, driverId: string, stars: number, comment?: string | null): Promise<RatePassengerResult> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, status: 422, code: 'VALIDATION', message: 'Stars must be 1–5.' };
  const text = comment?.trim() ? comment.trim().slice(0, 500) : null;
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true, passengerId: true } });
  if (!b) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Ride not found.' };
  if (b.status !== 'COMPLETED') return { ok: false, status: 409, code: 'NOT_COMPLETED', message: 'You can rate the passenger only after the ride is completed.' };
  const done = await prisma.assignment.findFirst({ where: { bookingId, driverId, reason: 'completed' }, select: { id: true } });
  if (!done) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not your ride.' };
  try {
    await prisma.passengerRating.create({ data: { bookingId, driverId, passengerId: b.passengerId, stars, comment: text } });
  } catch {
    return { ok: false, status: 409, code: 'ALREADY_RATED', message: 'This passenger has already been rated for this ride.' };
  }
  return { ok: true };
}

/** Average rating drivers gave a passenger (for staff). */
export async function passengerRatingSummary(passengerIds: string[]) {
  if (!passengerIds.length) return new Map<string, { average: number; count: number }>();
  const rows = await prisma.passengerRating.groupBy({ by: ['passengerId'], where: { passengerId: { in: passengerIds } }, _avg: { stars: true }, _count: { _all: true } });
  return new Map(rows.filter((r) => r.passengerId).map((r) => [r.passengerId!, { average: Math.round((r._avg.stars ?? 0) * 10) / 10, count: r._count._all }]));
}
