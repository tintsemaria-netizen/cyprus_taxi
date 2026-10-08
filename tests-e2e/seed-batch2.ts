// QA fixture for the batch-2 visual check (isolated _test DB only): one ASSIGNED ride with a live
// driver position, plus a FULL tracking token and a read-only share token.
import { prisma } from '../src/lib/db';
import { createBooking } from '../src/server/bookings';
import { assignBooking } from '../src/server/assignments';
import { createGrant, createShareGrant } from '../src/lib/tracking';

async function main() {
  if (!(process.env.DATABASE_URL || '').includes('_test')) throw new Error('refusing: not a _test DB');
  const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.assignment.updateMany({ where: { activeDriverId: d!.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d!.id }, data: { onDuty: true, available: true, active: true, ratingTotal: 47, ratingCount: 10 } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d!.id },
    update: { lat: 34.6795, lng: 33.0440, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: 'qa', sequence: Date.now() % 1e9 },
    create: { driverId: d!.id, lat: 34.6795, lng: 33.0440, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: 'qa', sequence: 1 },
  });
  const r = await createBooking({ pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Maria K.', phone: '+35799123456' } as never, `qa-${Date.now()}`);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  const a = await assignBooking({ bookingId: b.id, driverId: d!.id, vehicleId: d!.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 'qa', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign ' + a.code);
  const full = await createGrant(b.id, new Date());
  const share = await createShareGrant(b.id);
  console.log(JSON.stringify({ track: full.token, share: share.token, bookingId: b.id }));
}
main().finally(() => prisma.$disconnect());
