import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { rateTrip, validateRating, driverRatingSummary } from '@/server/ratings';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `rate-${RUN}-${++n}`;

async function driverAt(name: 'Andreas' | 'Maria', meters: number) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  const lat = marina.lat + meters * 0.000009;
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `r-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `r-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

// Create a booking owned by a fresh passenger and drive it all the way to COMPLETED.
async function completedBooking(name: 'Andreas' | 'Maria', meters = 20) {
  const { driverId, vehicleId } = await driverAt(name, meters);
  const passenger = await prisma.passenger.create({ data: { phone: `+3579${RUN.slice(-6)}${++n}`.slice(0, 15), phoneVerifiedAt: new Date(), name: 'Rider' } });
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.booking.update({ where: { id: b.id }, data: { passengerId: passenger.id } });
  const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed: ' + a.code);
  let rev = a.revision;
  const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId, actorId: 'u' });
  if (!er.ok) throw new Error('en_route failed'); rev = er.revision;
  const ar = await arriveAtPickup(b.id, driverId, rev);
  if (!ar.ok) throw new Error('arrive failed'); rev = ar.revision;
  const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
  const st = await startTrip(b.id, driverId, rev, code);
  if (!st.ok) throw new Error('start failed'); rev = st.revision;
  const co = await completeTrip(b.id, driverId, rev);
  if (!co.ok) throw new Error('complete failed');
  return { bookingId: b.id, driverId, passengerId: passenger.id };
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
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false, ratingTotal: 0, ratingCount: 0 } });
  }
});

describe('Task 020 — post-trip rating', () => {
  it('records a rating and increments the driver aggregate', async () => {
    const t = await completedBooking('Andreas');
    const res = await rateTrip({ bookingId: t.bookingId, passengerId: t.passengerId, stars: 5, tags: ['clean_car', 'safe_driving'], comment: 'Great ride' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stars).toBe(5);
      expect(res.driver).toEqual({ ratingAvg: 5, ratingCount: 1 });
    }
    const row = await prisma.tripRating.findUnique({ where: { bookingId: t.bookingId } });
    expect(row).not.toBeNull();
    expect(row!.driverId).toBe(t.driverId);
    expect(JSON.parse(row!.tags!)).toEqual(['clean_car', 'safe_driving']);
    const d = await prisma.driver.findUnique({ where: { id: t.driverId }, select: { ratingTotal: true, ratingCount: true } });
    expect(d).toEqual({ ratingTotal: 5, ratingCount: 1 });
  });

  it('rejects a second rating for the same booking (409 ALREADY_RATED)', async () => {
    const t = await completedBooking('Andreas');
    const first = await rateTrip({ bookingId: t.bookingId, passengerId: t.passengerId, stars: 4 });
    expect(first.ok).toBe(true);
    const second = await rateTrip({ bookingId: t.bookingId, passengerId: t.passengerId, stars: 1 });
    expect(second.ok).toBe(false);
    if (!second.ok) { expect(second.status).toBe(409); expect(second.code).toBe('ALREADY_RATED'); }
    // Aggregate reflects only the first rating.
    const d = await prisma.driver.findUnique({ where: { id: t.driverId }, select: { ratingTotal: true, ratingCount: true } });
    expect(d).toEqual({ ratingTotal: 4, ratingCount: 1 });
  });

  it('refuses to rate a ride that is not completed', async () => {
    const { driverId, vehicleId } = await driverAt('Andreas', 20);
    const passenger = await prisma.passenger.create({ data: { phone: `+357955${++n}`, phoneVerifiedAt: new Date() } });
    const r = await createBooking(input(), key());
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    await prisma.booking.update({ where: { id: b.id }, data: { passengerId: passenger.id } });
    await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    const res = await rateTrip({ bookingId: b.id, passengerId: passenger.id, stars: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.status).toBe(409); expect(res.code).toBe('NOT_COMPLETED'); }
  });

  it('refuses when the booking is not owned by the passenger (404)', async () => {
    const t = await completedBooking('Andreas');
    const res = await rateTrip({ bookingId: t.bookingId, passengerId: 'someone-else', stars: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('averages ratings across trips for the same driver', async () => {
    const a = await completedBooking('Andreas');
    const r1 = await rateTrip({ bookingId: a.bookingId, passengerId: a.passengerId, stars: 5 });
    expect(r1.ok).toBe(true);
    const b = await completedBooking('Andreas');
    const r2 = await rateTrip({ bookingId: b.bookingId, passengerId: b.passengerId, stars: 2 });
    expect(r2.ok).toBe(true);
    expect(a.driverId).toBe(b.driverId);
    const d = await prisma.driver.findUnique({ where: { id: a.driverId }, select: { ratingTotal: true, ratingCount: true } });
    expect(d).toEqual({ ratingTotal: 7, ratingCount: 2 });
    expect(driverRatingSummary(d!)).toEqual({ average: 3.5, count: 2 });
  });

  it('validateRating enforces stars, tag vocabulary and comment length', () => {
    expect(validateRating({ stars: 0 }).ok).toBe(false);
    expect(validateRating({ stars: 6 }).ok).toBe(false);
    expect(validateRating({ stars: 3.5 }).ok).toBe(false);
    expect(validateRating({ stars: 4, tags: ['not_a_real_tag'] }).ok).toBe(false);
    expect(validateRating({ stars: 4, comment: 'x'.repeat(501) }).ok).toBe(false);
    const good = validateRating({ stars: 4, tags: ['on_time', 'on_time'], comment: '  nice  ' });
    expect(good.ok).toBe(true);
    if (good.ok) { expect(good.tags).toEqual(['on_time']); expect(good.comment).toBe('nice'); }
  });

  it('driverRatingSummary reports no average before any ratings', () => {
    expect(driverRatingSummary({ ratingTotal: 0, ratingCount: 0 })).toEqual({ average: null, count: 0 });
  });
});
