import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { fareTotal } from '@/lib/fare-total';
export const dynamic = 'force-dynamic';
// The passenger's own ride history (account-based). Scoped to the session.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, reference: true, status: true, createdAt: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, fareCents: true, priceType: true, rating: { select: { stars: true } }, fare: { select: { estimateCents: true, waitingCents: true, finalCents: true } } },
  });
  const ids = rows.filter((b) => b.status === 'COMPLETED').map((b) => b.id);
  const sets = ids.length ? await prisma.driverSettlement.findMany({ where: { bookingId: { in: ids } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true, paymentReceived: true } }) : [];
  const settle = new Map(sets.map((s) => [s.bookingId, s])); // ascending → latest revision wins
  const ACTIVE = ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'NO_DRIVER'];
  return apiOk({ rides: rows.map((b) => ({
    id: b.id, reference: b.reference, status: b.status, active: ACTIVE.includes(b.status),
    at: (b.scheduledAt ?? b.createdAt).toISOString(), pickup: b.pickupLabel, dropoff: b.dropoffLabel,
    // Launch fixes §6: the same total as the receipt; `fareApprox` keeps the «≈» on any amount
    // that is not confirmed yet (meter rides until the driver enters the taximeter amount).
    ...(() => { const t = fareTotal({ priceType: b.priceType, completed: b.status === 'COMPLETED', fare: b.fare, settlement: settle.get(b.id) ?? null, quotedCents: b.fareCents }); return { fareCents: t.cents, fareApprox: t.approx, fareState: t.state }; })(),
    ratedStars: b.rating?.stars ?? null,
  })) });
}
