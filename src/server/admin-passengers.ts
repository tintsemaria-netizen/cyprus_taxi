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

// Full client profile for the admin (2026-11-14). Passwords are stored only as a one-way hash,
// so the admin sees whether one is set — never the password itself.
export async function passengerDetail(passengerId: string) {
  const p = await prisma.passenger.findUnique({ where: { id: passengerId } });
  if (!p) return null;
  const now = new Date();
  const [activeSessions, lastSession, places] = await Promise.all([
    prisma.passengerSession.count({ where: { passengerId, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.passengerSession.findFirst({ where: { passengerId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.savedPlace.findMany({ where: { passengerId }, select: { kind: true, label: true } }),
  ]);
  return {
    id: p.id, name: p.name, email: p.email, phone: p.phone,
    phoneVerifiedAt: p.phoneVerifiedAt?.toISOString() ?? null,
    hasPassword: !!p.passwordHash,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    activeSessions, lastLoginAt: lastSession?.createdAt.toISOString() ?? null,
    savedPlaces: places,
  };
}

// Admin password reset: a new temporary password (returned once, never stored in clear) and all of
// the client's sessions are signed out. Audited without the password.
export async function resetPassengerPassword(passengerId: string, actorId: string): Promise<string | null> {
  const { generateToken } = await import('@/lib/crypto');
  const { hashPassword } = await import('@/lib/auth');
  const p = await prisma.passenger.findUnique({ where: { id: passengerId }, select: { id: true } });
  if (!p) return null;
  const temporaryPassword = generateToken(9);
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction([
    prisma.passenger.update({ where: { id: passengerId }, data: { passwordHash } }),
    prisma.passengerSession.updateMany({ where: { passengerId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditEvent.create({ data: { actorId, actorRole: 'ADMIN', action: 'RESET_PASSENGER_PASSWORD', target: passengerId } }),
  ]);
  return temporaryPassword;
}
