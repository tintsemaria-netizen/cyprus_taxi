// QA fixture for the pre-booking visual check (isolated _test DB only).
import { prisma } from '../src/lib/db';
import { createBooking } from '../src/server/bookings';
import { createBookingSchema } from '../src/lib/validation';
import { claimScheduled } from '../src/server/dispatch/preassign';
import { createGrant } from '../src/lib/tracking';

async function ride(minutes: number, flight: string, key: string) {
  const input = createBookingSchema.parse({ pickup: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, dropoff: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Nikos P.', phone: '+35799123456', flightNumber: flight });
  const r = await createBooking(input, key);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  return prisma.booking.update({ where: { id: b.id }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + minutes * 60_000), fareCents: 6973, priceType: 'REGULATED_METER_ESTIMATE' } });
}

async function main() {
  if (!(process.env.DATABASE_URL || '').includes('_test')) throw new Error('refusing: not a _test DB');
  await prisma.preAssignment.deleteMany({});
  const maria = (await prisma.driver.findFirst({ where: { publicName: 'Maria' } }))!;
  await prisma.driver.update({ where: { id: maria.id }, data: { eligibility: 'LEGACY', active: true, ratingTotal: 46, ratingCount: 10 } });
  const stamp = Date.now();
  await ride(240, 'A3 612', `qa-pa-a-${stamp}`); // available on the board
  const mine = await ride(420, 'W6 4321', `qa-pa-b-${stamp}`);
  const c = await claimScheduled(maria.id, mine.id);
  if (!c.ok) throw new Error('claim ' + c.code);
  const g = await createGrant(mine.id, new Date());
  console.log(JSON.stringify({ track: g.token }));
}
main().finally(() => prisma.$disconnect());
