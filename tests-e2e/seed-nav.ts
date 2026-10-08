// QA fixture for the driver navigation screen (isolated _test DB only): Andreas has an ACCEPTED
// ride (status ASSIGNED) with pickup at Limassol Marina.
import { prisma } from '../src/lib/db';
import { createBooking } from '../src/server/bookings';
import { createBookingSchema } from '../src/lib/validation';
import { runOnce } from '../src/server/dispatch/worker';
import { acceptOffer, getDriverActiveOffer } from '../src/server/dispatch/offers';

async function main() {
  if (!(process.env.DATABASE_URL || '').includes('_test')) throw new Error('refusing: not a _test DB');
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  // Leftover open rides from other fixtures would compete for the offer.
  await prisma.booking.updateMany({ where: { status: { in: ['REQUESTED', 'SEARCHING'] } }, data: { status: 'CANCELED' } });
  await prisma.preAssignment.deleteMany({});
  await prisma.assignment.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  for (const d of await prisma.driver.findMany()) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  const a = (await prisma.driver.findFirst({ where: { publicName: 'Andreas' } }))!;
  await prisma.driver.update({ where: { id: a.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  const loc = { lat: 34.6766, lng: 33.0413, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `qa-nav-${now.getTime()}`, sequence: 1 };
  await prisma.latestDriverLocation.upsert({ where: { driverId: a.id }, update: loc, create: { driverId: a.id, ...loc } });
  const input = createBookingSchema.parse({ pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Eleni K.', phone: '+35799123456', note: 'Blue suitcase' });
  const r = await createBooking(input, `qa-nav-${now.getTime()}`);
  if (!r.ok) throw new Error('create');
  await runOnce();
  const o = await getDriverActiveOffer(a.id);
  if (!o) throw new Error('no offer for Andreas');
  const acc = await acceptOffer(o.offerId, a.id);
  if (!acc.ok) throw new Error('accept failed');
  console.log(JSON.stringify({ reference: r.body.reference }));
}
main().finally(() => prisma.$disconnect());
