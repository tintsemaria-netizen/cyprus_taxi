import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
export const dynamic = 'force-dynamic';

// The passenger's ride that is happening right now, if any (2026-11-17): reopening the app after
// closing it goes straight back to this ride's tracking screen. A ride counts while a driver is
// being searched for (an immediate order) or a driver is assigned / on the way / waiting / driving.
// Scheduled rides only count once a driver is assigned for them.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const b = await prisma.booking.findFirst({
    where: {
      passengerId: p.id,
      OR: [
        { status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
        { status: { in: ['REQUESTED', 'SEARCHING'] }, scheduledAt: null },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  return apiOk({ ride: b ? { id: b.id, status: b.status } : null });
}
