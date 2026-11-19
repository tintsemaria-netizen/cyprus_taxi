import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { driverCurrentTrip } from '@/server/views';
import { farePreview } from '@/server/trip-close';
import { createBookingSchema } from '@/lib/validation';

// GPS taximeter end-to-end: live on the driver's screen, recorded on completion (not charged).
const dbName = (() => { try { return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
const lca = { lat: 34.8751, lng: 33.6249, label: 'LCA' };
const nicosia = { lat: 35.1667, lng: 33.3667, label: 'Nicosia' };
let n = 0;

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error('Refusing: not a _test DB'); });
beforeEach(async () => {
  for (const m of ['shareGroup', 'preAssignment', 'notificationOutbox', 'chatMessage', 'fare', 'receiptEmail', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'idempotencyReceipt', 'passengerRating', 'tripRating', 'gpsSample', 'booking'] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
  await prisma.driver.updateMany({ data: { onDuty: false, available: false } });
});

describe('GPS taximeter (DB)', () => {
  it('shows the meter while on board and records it at completion; the charged fare is unchanged', async () => {
    const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, eligibility: 'LEGACY' } });
    const now = new Date();
    await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: lca.lat, lng: lca.lng, accuracyM: 5, sampledAt: now, receivedAt: now, gpsSession: 'm', sequence: ++n }, create: { driverId: d.id, lat: lca.lat, lng: lca.lng, accuracyM: 5, sampledAt: now, receivedAt: now, gpsSession: 'm', sequence: ++n } });
    const r = await createBooking(createBookingSchema.parse({ pickup: lca, dropoff: nicosia, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, luggageCount: 0, passengerName: 'P', phone: '+35799123456' }), `meter-${Date.now()}`);
    if (!r.ok) throw new Error(r.code);
    let b = await prisma.booking.update({ where: { reference: r.body.reference }, data: { fareCents: 6000, priceType: 'REGULATED_METER_ESTIMATE' } });
    await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
    const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    if (!a.ok) throw new Error(a.code);
    await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'DRIVER', driverId: d.id });
    b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect((await arriveAtPickup(b.id, d.id, b.revision)).ok).toBe(true);
    b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect((await startTrip(b.id, d.id, b.revision, '')).ok).toBe(true);

    // 10 minutes at 60 km/h north (10 km), a point every 5 s, after the trip started.
    const t0 = Date.now() - 10 * 60_000 + 1000;
    await prisma.bookingEvent.updateMany({ where: { bookingId: b.id, type: 'TRIP_STARTED' }, data: { createdAt: new Date(t0 - 500) } });
    // A sample from BEFORE the trip started is not counted.
    await prisma.gpsSample.create({ data: { driverId: d.id, gpsSession: 'm', sequence: 0, lat: 34.6, lng: 33.6, accuracyM: 5, sampledAt: new Date(t0 - 60_000), bookingId: b.id } });
    for (let s = 0; s <= 595; s += 5) {
      await prisma.gpsSample.create({ data: { driverId: d.id, gpsSession: 'm', sequence: s + 1, lat: 34.88 + ((60 * s) / 3600) / 111.195, lng: 33.62, accuracyM: 6, sampledAt: new Date(t0 + s * 1000), bookingId: b.id } });
    }
    const v = await driverCurrentTrip(d.id);
    expect(v.gpsMeter?.totalKm).toBeCloseTo(9.92, 1);
    const p = (await farePreview(b.id, d.id))!;
    expect(p.gpsMeter?.totalCents).toBe(v.gpsMeter?.totalCents);
    expect(p.totalCents).toBe(6000); // the charged figure is still the estimate

    b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect((await completeTrip(b.id, d.id, b.revision)).ok).toBe(true);
    const f = await prisma.fare.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(f.gpsMeterKm).toBeCloseTo(9.92, 1);
    expect(f.gpsMeterCents).toBe(v.gpsMeter!.totalCents);
    expect(f.estimateCents).toBe(6000);
  });
});
