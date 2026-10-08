import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { driverReliability, driverReliabilityDetail, LATE_RELEASE_REASON, GPS_LOSS_REASON } from '@/server/admin/reliability';
import { createBookingSchema } from '@/lib/validation';

const RUN = `${Date.now()}`;
let n = 0;
async function booking() {
  const r = await createBooking(createBookingSchema.parse({ pickup: { lat: 34.67, lng: 33.04, label: 'A' }, dropoff: { lat: 34.87, lng: 33.62, label: 'B' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'P', phone: '+35799123456' }), `rel-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}

beforeAll(async () => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });
beforeEach(async () => {
  for (const t of ['preAssignment', 'tripRating', 'chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'idempotencyReceipt', 'notificationOutbox', 'booking'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any)[t].deleteMany({});
  }
});

describe('admin driver reliability', () => {
  it('counts offers/trips/pre-bookings/ratings per driver and raises the documented flags', async () => {
    const a = (await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } }))!;
    const maria = (await prisma.driver.findFirst({ where: { publicName: 'Maria' } }))!;
    await prisma.driver.updateMany({ data: { onDuty: false } }); // live-state flags covered separately
    const vehicleId = a.bindings[0].vehicleId;
    // 11 answered/expired offers: 3 accepted, 4 rejected, 4 expired (+1 system-cancelled, excluded).
    const statuses = ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'EXPIRED', 'EXPIRED', 'EXPIRED', 'EXPIRED', 'CANCELED'];
    for (const s of statuses) {
      const b = await booking();
      await prisma.driverOffer.create({ data: { bookingId: b.id, driverId: a.id, vehicleId, status: s, expiresAt: new Date() } });
    }
    // 2 completed trips, 1 GPS release, 3 driver cancels before pickup.
    for (const reason of ['completed', 'completed', GPS_LOSS_REASON]) {
      const b = await booking();
      await prisma.assignment.create({ data: { bookingId: b.id, driverId: a.id, vehicleId, driverPublicName: 'A', driverPhone: '1', vehiclePlate: 'P', vehicleMake: 'M', vehicleModel: 'M', vehicleColor: 'C', vehicleClass: 'COMFORT', actor: 't', endedAt: new Date(), reason } });
    }
    for (let i = 0; i < 3; i++) {
      const b = await booking();
      await prisma.bookingEvent.create({ data: { bookingId: b.id, type: 'REMATCH', actorType: 'DRIVER', actorId: a.id, afterStatus: 'SEARCHING', reason: 'flat tyre' } });
    }
    // Pre-bookings: 1 converted, 2 late releases, 1 normal release, 1 lapsed.
    for (const [status, endReason] of [['CONVERTED', 'converted to assignment'], ['RELEASED', LATE_RELEASE_REASON], ['RELEASED', LATE_RELEASE_REASON], ['RELEASED', 'driver released'], ['LAPSED', 'driver offline at conversion']] as const) {
      const b = await booking();
      await prisma.preAssignment.create({ data: { bookingId: b.id, driverId: a.id, vehicleId, pickupAt: new Date(), status, endReason, endedAt: new Date() } });
    }
    // 5 ratings averaging 3.0, two of them low.
    for (const stars of [5, 4, 3, 2, 1]) {
      const b = await booking();
      await prisma.tripRating.create({ data: { bookingId: b.id, driverId: a.id, passengerId: 'p', stars, comment: stars === 1 ? 'Rude and late' : null, tags: stars <= 2 ? JSON.stringify(['late']) : null } });
    }

    const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 60_000);
    const rows = await driverReliability(from, to);
    const ra = rows.find((r) => r.driverId === a.id)!;
    expect(ra.offers).toEqual({ total: 11, accepted: 3, rejected: 4, missed: 4, acceptancePct: 27, missedPct: 36 });
    expect(ra.trips).toEqual({ completed: 2, preCancels: 3, gpsReleases: 1 });
    expect(ra.prebook).toEqual({ taken: 5, converted: 1, lateReleases: 2, releases: 3, lapsed: 1 });
    expect(ra.rating).toEqual({ average: 3, count: 5, low: 2 });
    expect(ra.flags.sort()).toEqual(['LATE_RELEASES', 'LOW_ACCEPTANCE', 'LOW_RATING', 'MISSED_OFFERS', 'PRE_PICKUP_CANCELS']);
    expect(rows[0].driverId).toBe(a.id); // flagged drivers first
    const rm = rows.find((r) => r.driverId === maria.id)!;
    expect(rm.flags).toEqual([]);
    expect(rm.offers.acceptancePct).toBeNull();

    const ev = await driverReliabilityDetail(a.id, from, to);
    const kinds = ev.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'PREBOOK_LATE_RELEASE')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'PRE_PICKUP_CANCEL')).toHaveLength(3);
    expect(kinds).toContain('GPS_RELEASE');
    expect(kinds).toContain('PREBOOK_LAPSED');
    expect(ev.find((e) => e.kind === 'LOW_RATING' && e.detail.includes('Rude and late'))).toBeTruthy();
    // Outside the window nothing is counted.
    const past = await driverReliability(new Date(Date.now() - 10 * 86_400_000), new Date(Date.now() - 5 * 86_400_000));
    expect(past.find((r) => r.driverId === a.id)!.offers.total).toBe(0);
  });
});

describe('live-state flags', () => {
  it('flags a driver who is on duty without a vehicle and with stale GPS', async () => {
    const m = (await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { bindings: { where: { endedAt: null } } } }))!;
    const vehicleId = m.bindings[0].vehicleId;
    await prisma.driverVehicleBinding.updateMany({ where: { driverId: m.id, endedAt: null }, data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null } });
    await prisma.driver.update({ where: { id: m.id }, data: { onDuty: true } });
    const old = new Date(Date.now() - 3 * 86_400_000);
    await prisma.latestDriverLocation.upsert({ where: { driverId: m.id }, update: { sampledAt: old, receivedAt: old }, create: { driverId: m.id, lat: 34.7, lng: 33.0, accuracyM: 8, sampledAt: old, receivedAt: old, gpsSession: 'rel', sequence: 1 } });
    try {
      const row = (await driverReliability(new Date(Date.now() - 86_400_000), new Date())).find((r) => r.driverId === m.id)!;
      expect(row.state.onDuty).toBe(true);
      expect(row.state.vehicle).toBeNull();
      expect(row.state.gpsAgeSec).toBeGreaterThan(86_400);
      expect(row.flags).toEqual(expect.arrayContaining(['ONLINE_NO_VEHICLE', 'ONLINE_STALE_GPS']));
    } finally {
      await prisma.driver.update({ where: { id: m.id }, data: { onDuty: false } });
      await prisma.driverVehicleBinding.create({ data: { driverId: m.id, vehicleId, activeDriverId: m.id, activeVehicleId: vehicleId } });
      await prisma.latestDriverLocation.deleteMany({ where: { driverId: m.id } });
    }
  });
});
