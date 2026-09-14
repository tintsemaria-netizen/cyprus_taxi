import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
export const dynamic = 'force-dynamic';
// The passenger's own ride history (account-based). Scoped to the session.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, reference: true, status: true, createdAt: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, fareCents: true },
  });
  const ACTIVE = ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'NO_DRIVER'];
  return apiOk({ rides: rows.map((b) => ({
    id: b.id, reference: b.reference, status: b.status, active: ACTIVE.includes(b.status),
    at: (b.scheduledAt ?? b.createdAt).toISOString(), pickup: b.pickupLabel, dropoff: b.dropoffLabel, fareCents: b.fareCents,
  })) });
}
