import { bookingMinCents } from '@/server/min-fares';
import { prisma } from '@/lib/db';
import { createQuote, consumeQuote } from '@/server/quote';
import { enqueueDriver } from '@/server/push';

// Passenger adds / replaces / removes the ONE intermediate stop on a live ride (2026-11-15):
// «забыли или планы поменялись». Allowed from search until the trip ends, as long as the car
// has not reached the current stop yet. The meter estimate is re-quoted server-side for the new
// route (the final fare is still the taximeter); the assigned driver is notified and their
// navigation picks the stop up from the trip view.
const OPEN = ['SEARCHING', 'NO_DRIVER', 'REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

export type StopChange = { lat: number; lng: number; label: string } | null;
export type StopResult = { ok: true; fareCents: number | null } | { ok: false; status: number; code: string; message: string };

export async function passengerSetStop(bookingId: string, stop: StopChange): Promise<StopResult> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
  if (!OPEN.includes(b.status)) return { ok: false, status: 409, code: 'BAD_STATE', message: 'The ride is over.' };
  if (b.stopArrivedAt) return { ok: false, status: 409, code: 'STOP_LOCKED', message: 'The car is already at (or past) the stop.' };
  // Ride-share «Попутчик» (2026-11-19): a co-rider ride has no intermediate stop.
  if (stop && b.shareOptIn) return { ok: false, status: 409, code: 'SHARE_NO_STOP', message: 'A ride with a co-rider cannot have a stop.' };
  if (!stop && b.stopLat == null) return { ok: true, fareCents: b.fareCents ?? null };

  // New estimate for the new route (outside the lock — it may call the routing API).
  let fare: { fareCents: number; priceType: string; fareBreakdown: string; quoteId: string } | null = null;
  try {
    const input = {
      pickup: { lat: b.pickupLat, lng: b.pickupLng }, dropoff: { lat: b.dropoffLat, lng: b.dropoffLng },
      stop: stop ? { lat: stop.lat, lng: stop.lng } : null, vClass: b.vClass as 'COMFORT' | 'XL',
      passengerCount: b.passengerCount, luggageCount: b.luggageCount ?? 0,
      scheduledAtUtc: b.status === 'REQUESTED' && b.scheduledAt ? b.scheduledAt.toISOString() : null,
    };
    const q = await createQuote(input);
    if (q.ok) {
      const c = await consumeQuote(q.quote.quoteId, input);
      // A pre-booking in Nicosia keeps its minimum after a stop is added mid-trip (2026-11-22).
      if (c.ok) fare = { fareCents: Math.max((await bookingMinCents(b)) ?? 0, c.totalCents), priceType: c.priceType, fareBreakdown: c.breakdown, quoteId: q.quote.quoteId };
    }
  } catch { fare = null; } // keep the old estimate rather than block the change

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const cur = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!cur || !OPEN.includes(cur.status)) return { ok: false as const, status: 409, code: 'BAD_STATE', message: 'The ride is over.' };
    if (cur.stopArrivedAt) return { ok: false as const, status: 409, code: 'STOP_LOCKED', message: 'The car is already at (or past) the stop.' };
    const u = await tx.booking.update({
      where: { id: bookingId },
      data: {
        stopLat: stop?.lat ?? null, stopLng: stop?.lng ?? null, stopLabel: stop ? stop.label.slice(0, 300) : null,
        stopArrivedAt: null, stopWaitStartedAt: null, stopDepartedAt: null, stopWaitCents: null,
        ...(fare ? { quoteId: fare.quoteId, fareCents: fare.fareCents, priceType: fare.priceType, fareBreakdown: fare.fareBreakdown } : {}),
        revision: { increment: 1 },
      },
    });
    await tx.bookingEvent.create({ data: { bookingId, type: stop ? 'STOP_SET' : 'STOP_REMOVED', actorType: 'PASSENGER', actorId: 'tracking', beforeStatus: cur.status, afterStatus: cur.status } });
    const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
    if (a?.activeDriverId) {
      await enqueueDriver(tx, a.activeDriverId, stop ? 'Stop added by the passenger' : 'Stop removed by the passenger',
        stop ? `New stop: ${stop.label}` : 'The passenger removed the stop.', { tag: `stop-${bookingId}` });
    }
    return { ok: true as const, fareCents: u.fareCents ?? null };
  });
}
