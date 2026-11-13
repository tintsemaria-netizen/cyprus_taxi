import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';

export const dynamic = 'force-dynamic';

const REMIND_MIN = 60;

// The passenger's upcoming pre-bookings (scheduled rides not finished/cancelled), soonest first.
// `soon` marks rides whose pickup is within the next hour (shown as a reminder on the home page).
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const now = Date.now();
  const rows = await prisma.booking.findMany({
    where: {
      passengerId: p.id,
      scheduledAt: { not: null, gte: new Date(now - 2 * 3600_000) },
      status: { in: ['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED'] },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
    select: {
      id: true, reference: true, status: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, note: true, fareCents: true,
      preAssignments: { where: { status: 'COMMITTED' }, select: { driver: { select: { publicName: true } } }, take: 1 },
    },
  });
  return apiOk({
    prebookings: rows.map((b) => {
      const at = b.scheduledAt!.getTime();
      return {
        id: b.id, reference: b.reference, status: b.status, at: b.scheduledAt!.toISOString(),
        pickup: b.pickupLabel, dropoff: b.dropoffLabel, note: b.note, fareCents: b.fareCents,
        driverConfirmed: b.preAssignments[0]?.driver.publicName ?? null,
        soon: at - now <= REMIND_MIN * 60_000 && at - now > -30 * 60_000,
      };
    }),
  });
}
