import { prisma } from '@/lib/db';
import { enqueuePassenger } from '@/server/push';

// Pre-booking reminder for the PASSENGER (2026-11-13): about an hour before pickup, one push
// "Your pre-booked ride is in ~1 hour" (the home page shows the same ride as a reminder card).
// Exactly once per ride: `passengerRemindedAt` is claimed with a conditional update (fencing
// against a second worker), and the outbox dedupe key guards the notification itself.
export const PASSENGER_REMIND_MIN = 60;
const ACTIVE = ['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE'] as const;

const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' });

export async function runPassengerReminders(now: Date = new Date()): Promise<number> {
  const due = await prisma.booking.findMany({
    where: {
      scheduledAt: { gt: now, lte: new Date(now.getTime() + PASSENGER_REMIND_MIN * 60_000) },
      passengerRemindedAt: null,
      status: { in: [...ACTIVE] },
    },
    select: { id: true, scheduledAt: true, pickupLabel: true },
    take: 50,
  });
  let sent = 0;
  for (const b of due) {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.booking.updateMany({ where: { id: b.id, passengerRemindedAt: null }, data: { passengerRemindedAt: now } });
      if (upd.count !== 1) return; // another worker took it
      await enqueuePassenger(tx, b.id, 'Your pre-booked ride is in about an hour',
        `Pickup at ${hhmm(b.scheduledAt!)} (Cyprus time) — ${b.pickupLabel}.`,
        { url: '/prebookings', tag: `remind-${b.id}`, dedupeKey: `passenger-remind:${b.id}` });
      sent++;
    });
  }
  return sent;
}
