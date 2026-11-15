import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup } from '@/server/dispatch/lifecycle';
import type { CreateBookingInput } from '@/lib/validation';
async function main() {
  const pax = await prisma.passenger.create({ data: { name: 'Nav', email: `nav${Date.now()}@example.com` } });
  const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { activeDriverId: null, activeBookingId: null, activeVehicleId: null, endedAt: new Date() } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true } });
  const now = new Date(); await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: 34.6706, lng: 33.0413, sampledAt: now, receivedAt: now }, create: { driverId: d.id, lat: 34.6706, lng: 33.0413, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: 't', sequence: 1 } });
  const r = await createBooking({ pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Nav', phone: '+35799123456' } as CreateBookingInput, `nav-${Date.now()}`, undefined, pax.id);
  if (!r.ok) throw new Error('create');
  let b = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } }).catch(() => {});
  const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true }); if (!a.ok) throw new Error('assign');
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  if (b.status === 'ASSIGNED') await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: b.revision, actor: 'DRIVER', driverId: d.id, actorId: 'u' });
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  if (!(await arriveAtPickup(b.id, d.id, b.revision)).ok) throw new Error('arrive');
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  console.log(b.startCode);
}
main().catch((e) => console.error('ERR', e.message)).finally(() => prisma.$disconnect());
