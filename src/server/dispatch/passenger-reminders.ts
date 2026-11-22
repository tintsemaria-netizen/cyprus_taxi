import { prisma } from '@/lib/db';
import { enqueuePassenger } from '@/server/push';

// Pre-booking reminders for the PASSENGER: about an hour before pickup (2026-11-13) and again
// 30 minutes before (operator, 2026-11-22). Each exactly once per ride: its own timestamp is
// claimed with a conditional update (fencing against a second worker) and the outbox dedupe key
// guards the notification. A ride already inside the 30-minute window gets only the second one.
export const PASSENGER_REMIND_MIN = 60;
export const PASSENGER_REMIND2_MIN = 30;
const ACTIVE = ['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE'] as const;

const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' });

export async function runPassengerReminders(now: Date = new Date()): Promise<number> {
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  const stages = [
    { field: 'passengerRemindedAt' as const, from: at(PASSENGER_REMIND2_MIN), to: at(PASSENGER_REMIND_MIN), k: 'pre.remind60', title: 'Your pre-booked ride is in about an hour', dedupe: 'passenger-remind' },
    { field: 'passengerRemind30At' as const, from: now, to: at(PASSENGER_REMIND2_MIN), k: 'pre.remind30', title: 'Your pre-booked ride is in 30 minutes', dedupe: 'passenger-remind30' },
  ];
  let sent = 0;
  for (const st of stages) {
    const due = await prisma.booking.findMany({
      where: { scheduledAt: { gt: st.from, lte: st.to }, [st.field]: null, status: { in: [...ACTIVE] } },
      select: { id: true, scheduledAt: true, pickupLabel: true },
      take: 50,
    });
    for (const b of due) {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.booking.updateMany({ where: { id: b.id, [st.field]: null }, data: { [st.field]: now } });
        if (upd.count !== 1) return; // another worker took it
        const time = hhmm(b.scheduledAt!);
        await enqueuePassenger(tx, b.id, st.title, `Pickup at ${time} (Cyprus time) — ${b.pickupLabel}.`,
          { url: '/prebookings', tag: `remind-${b.id}`, dedupeKey: `${st.dedupe}:${b.id}`, msg: { k: st.k, p: { timeT: b.scheduledAt!.toISOString(), place: b.pickupLabel } } });
        sent++;
      });
    }
  }
  return sent;
}
