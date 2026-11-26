import { prisma } from '@/lib/db';
import { pairStops, type PairStops, type PlanStep } from '@/lib/pair-stops';
import { leg } from '@/server/share-detail';
import { passengerRatingSummary } from '@/server/passenger-rating';

/** The driver's accepted ride-share pair around this primary trip, as ordered stops (null when riding alone). */
export async function pairStopsFor(driverId: string, primaryBookingId: string): Promise<PairStops | null> {
  const g = await prisma.shareGroup.findFirst({
    where: { status: 'ACCEPTED', driverId, OR: [{ activeHostBookingId: primaryBookingId }, { activeGuestBookingId: primaryBookingId }] },
    include: { host: true, guest: true },
  });
  if (!g) return null;
  const plan = (g.plan as PlanStep[] | null) ?? [];
  if (plan.length === 0) return null;
  const p = pairStops(plan, g.host, g.guest, primaryBookingId);
  // Time between the stops (operator, 2026-11-23): 1 → 2, 2 → 3, 3 → 4 by road (cached), else an estimate.
  const legs = await Promise.all(p.stops.slice(0, -1).map((s, i) => leg(s, p.stops[i + 1], null).catch(() => null)));
  p.stops.forEach((s, i) => { s.toNextMin = legs[i]?.min ?? null; });
  // Each passenger's rating next to the name, the co-rider's too (2026-11-26, operator).
  const ratings = await passengerRatingSummary([g.host.passengerId ?? '', g.guest.passengerId ?? ''].filter(Boolean));
  p.stops.forEach((s) => { const pid = s.bookingId === g.host.id ? g.host.passengerId : g.guest.passengerId; s.rating = (pid && ratings.get(pid)) || null; });
  return p;
}
