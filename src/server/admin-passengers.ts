import { prisma } from '@/lib/db';

// Admin: passenger (client) accounts with ride counts (2026-11-14).
export interface PassengerRow {
  id: string; name: string | null; phone: string | null; email: string | null; createdAt: string;
  rides: number; completed: number; canceled: number; lastRideAt: string | null; lastSeenAt: string | null;
}

export async function listPassengers(q = '', limit = 200): Promise<{ total: number; passengers: PassengerRow[] }> {
  const term = q.trim();
  const where = term
    ? { OR: [
        { name: { contains: term, mode: 'insensitive' as const } },
        { email: { contains: term, mode: 'insensitive' as const } },
        { phone: { contains: term.replace(/\s+/g, '') } },
      ] }
    : {};
  const [total, list] = await Promise.all([
    prisma.passenger.count({ where }),
    prisma.passenger.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
  ]);
  const ids = list.map((p) => p.id);
  const [byStatus, lastRide, lastSession] = ids.length ? await Promise.all([
    prisma.booking.groupBy({ by: ['passengerId', 'status'], where: { passengerId: { in: ids } }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['passengerId'], where: { passengerId: { in: ids } }, _max: { createdAt: true } }),
    prisma.passengerSession.groupBy({ by: ['passengerId'], where: { passengerId: { in: ids } }, _max: { createdAt: true } }),
  ]) : [[], [], []];
  return {
    total,
    passengers: list.map((p) => {
      const mine = byStatus.filter((r) => r.passengerId === p.id);
      const count = (s?: string) => mine.filter((r) => !s || r.status === s).reduce((a, r) => a + r._count._all, 0);
      const lr = lastRide.find((r) => r.passengerId === p.id)?._max.createdAt;
      const ls = lastSession.find((r) => r.passengerId === p.id)?._max.createdAt;
      return {
        id: p.id, name: p.name, phone: p.phone, email: p.email, createdAt: p.createdAt.toISOString(),
        rides: count(), completed: count('COMPLETED'), canceled: count('CANCELED'),
        lastRideAt: lr ? lr.toISOString() : null, lastSeenAt: ls ? ls.toISOString() : null,
      };
    }),
  };
}

export async function passengerRides(passengerId: string, limit = 50) {
  const rows = await prisma.booking.findMany({
    where: { passengerId }, orderBy: { createdAt: 'desc' }, take: limit,
    select: { id: true, reference: true, status: true, pickupLabel: true, dropoffLabel: true, scheduledAt: true, createdAt: true, vClass: true },
  });
  return rows.map((b) => ({ ...b, scheduledAt: b.scheduledAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString() }));
}
