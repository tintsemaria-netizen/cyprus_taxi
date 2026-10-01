import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { passengerReceipt } from '@/server/receipt';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `rcpt-${RUN}-${++n}`;

async function driverAt(name: 'Andreas' | 'Maria', meters: number) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: marina.lat + meters * 0.000009, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `rc-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: marina.lat + meters * 0.000009, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `rc-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

async function completedBooking() {
  const { driverId, vehicleId } = await driverAt('Andreas', 20);
  const passenger = await prisma.passenger.create({ data: { phone: `+35794${RUN.slice(-6)}${++n}`.slice(0, 15), phoneVerifiedAt: new Date() } });
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  // Simulate a quoted booking so the completed Fare carries an estimate + itemised breakdown.
  await prisma.booking.update({
    where: { id: b.id },
    data: {
      passengerId: passenger.id,
      fareCents: 965,
      priceType: 'REGULATED_METER_ESTIMATE',
      fareBreakdown: JSON.stringify([
        { code: 'initial', label: 'Initial hire (day tariff)', cents: 600 },
        { code: 'distance', label: 'Distance 5.0 km × €0.73/km', cents: 365 },
      ]),
    },
  });
  const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed'); let rev = a.revision;
  const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId, actorId: 'u' }); if (!er.ok) throw new Error('er'); rev = er.revision;
  const ar = await arriveAtPickup(b.id, driverId, rev); if (!ar.ok) throw new Error('ar'); rev = ar.revision;
  const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
  const st = await startTrip(b.id, driverId, rev, code); if (!st.ok) throw new Error('st'); rev = st.revision;
  const co = await completeTrip(b.id, driverId, rev); if (!co.ok) throw new Error('co');
  return { bookingId: b.id, passengerId: passenger.id, reference: b.reference };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  await prisma.tripRating.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.passengerSession.deleteMany({});
  await prisma.passenger.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('Task 020 — passenger ride receipt', () => {
  it('returns a receipt for a completed, owned ride with driver snapshot + regulated note', async () => {
    const t = await completedBooking();
    const res = await passengerReceipt(t.bookingId, t.passengerId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.receipt;
      expect(r.reference).toBe(t.reference);
      expect(r.completedAt).not.toBeNull();
      expect(r.pickup).toBe(marina.label);
      expect(r.dropoff).toBe(lca.label);
      expect(r.driver?.name).toBeTruthy();
      expect(r.driver?.plate).toBeTruthy();
      // Regulated meter estimate: final metered in vehicle (finalCents null), estimate present.
      expect(r.fare.isUpfront).toBe(false);
      expect(r.fare.finalCents).toBeNull();
      expect(r.fare.estimateCents).not.toBeNull();
      expect(r.fare.lines.length).toBeGreaterThan(0);
      expect(r.fare.paymentMethod).toBe('CASH_TO_DRIVER');
      expect(r.fare.paymentStatus).toBe('PENDING');
      expect(r.rating).toBeNull();
    }
  });

  it('refuses a receipt for a ride not owned by the passenger (404)', async () => {
    const t = await completedBooking();
    const res = await passengerReceipt(t.bookingId, 'not-the-owner');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('has no receipt before completion (409 NO_RECEIPT)', async () => {
    const { driverId, vehicleId } = await driverAt('Andreas', 20);
    const passenger = await prisma.passenger.create({ data: { phone: `+35793${++n}`, phoneVerifiedAt: new Date() } });
    const r = await createBooking(input(), key());
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    await prisma.booking.update({ where: { id: b.id }, data: { passengerId: passenger.id } });
    await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    const res = await passengerReceipt(b.id, passenger.id);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.status).toBe(409); expect(res.code).toBe('NO_RECEIPT'); }
  });
});
