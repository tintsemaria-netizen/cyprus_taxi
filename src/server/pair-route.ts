import { prisma } from '@/lib/db';
import { pairStops, type PairStops, type PlanStep } from '@/lib/pair-stops';

/** The driver's accepted ride-share pair around this primary trip, as ordered stops (null when riding alone). */
export async function pairStopsFor(driverId: string, primaryBookingId: string): Promise<PairStops | null> {
  const g = await prisma.shareGroup.findFirst({
    where: { status: 'ACCEPTED', driverId, OR: [{ activeHostBookingId: primaryBookingId }, { activeGuestBookingId: primaryBookingId }] },
    include: { host: true, guest: true },
  });
  if (!g) return null;
  const plan = (g.plan as PlanStep[] | null) ?? [];
  if (plan.length === 0) return null;
  return pairStops(plan, g.host, g.guest, primaryBookingId);
}
