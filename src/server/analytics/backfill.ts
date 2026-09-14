import { prisma } from '@/lib/db';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';

// Backfill (Task 016 §7). Bookings created BEFORE the domain-event model have no events. This
// seeds ONE reconstructed snapshot event per such booking so historical bookings appear in
// analytics — clearly marked `reconstructed: true` and typed `booking.backfill_snapshot`, never
// disguised as a captured lifecycle event. It NEVER invents data that was not recorded (no past
// GPS, provider latency, or driver-online intervals). Idempotent (skips bookings that already
// have any event) and restartable via keyset pagination; bounded batch, no full-table load.

export interface BackfillResult { scanned: number; seeded: number; done: boolean; lastCreatedAt: string | null }

export async function backfillBookingSnapshots(batch = 200, afterCreatedAt?: Date): Promise<BackfillResult> {
  const bookings = await prisma.booking.findMany({
    where: afterCreatedAt ? { createdAt: { gt: afterCreatedAt } } : {},
    orderBy: { createdAt: 'asc' },
    take: batch,
    select: { id: true, vClass: true, passengerCount: true, status: true, priceType: true, fareCents: true, scheduledAt: true, passengerId: true, revision: true, createdAt: true },
  });
  let seeded = 0;
  for (const b of bookings) {
    // Skip if this booking already has captured events (real events win; never overwrite).
    const has = await prisma.domainEvent.findFirst({ where: { aggregateType: 'booking', aggregateId: b.id }, select: { id: true } });
    if (has) continue;
    // Attribute the completing driver where knowable (immutable assignment snapshot).
    const asg = await prisma.assignment.findFirst({ where: { bookingId: b.id, reason: 'completed' }, orderBy: { endedAt: 'desc' }, select: { driverId: true } });
    await prisma.$transaction(async (tx) => {
      await recordEvent(tx, {
        eventType: 'booking.backfill_snapshot',
        aggregateType: 'booking', aggregateId: b.id, aggregateVersion: b.revision, eventOrdinal: 0,
        occurredAt: b.createdAt,
        payload: {
          ...bookingEventPayload(b),
          reconstructed: true,
          driverPseudo: asg ? driverPseudo(asg.driverId) : null,
        },
      });
    });
    seeded++;
  }
  const last = bookings.length ? bookings[bookings.length - 1].createdAt : null;
  return { scanned: bookings.length, seeded, done: bookings.length < batch, lastCreatedAt: last ? last.toISOString() : null };
}
