import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { isFixedPrice } from '@/lib/price-type';
export const dynamic = 'force-dynamic';
// The passenger's own ride history (account-based). Scoped to the session.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, reference: true, status: true, createdAt: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, fareCents: true, priceType: true, rating: { select: { stars: true } }, fare: { select: { estimateCents: true, waitingCents: true, finalCents: true } } },
  });
  // NO_DRIVER is not «live» in the history (2026-11-20): it «did not take place» — no «Следить онлайн»
  // that leads to «Искать снова» on an old route. The booking screen still offers a fresh retry.
  const ACTIVE = ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
  return apiOk({ rides: rows.map((b) => ({
    id: b.id, reference: b.reference, status: b.status, active: ACTIVE.includes(b.status),
    at: (b.scheduledAt ?? b.createdAt).toISOString(), pickup: b.pickupLabel, dropoff: b.dropoffLabel,
    // Same total as the receipt (waiting included) once the ride is completed (2026-11-17).
    fareCents: b.fare ? (isFixedPrice(b.priceType) ? (b.fare.finalCents != null ? b.fare.finalCents + b.fare.waitingCents : null) : b.fare.estimateCents != null ? b.fare.estimateCents + b.fare.waitingCents : null) : b.fareCents,
    ratedStars: b.rating?.stars ?? null,
  })) });
}
