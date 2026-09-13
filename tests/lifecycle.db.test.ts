import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip, driverCancelPrePickup } from '@/server/dispatch/lifecycle';
import { runOnce } from '@/server/dispatch/worker';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `life-${RUN}-${++n}`;

async function driverAt(name: 'Andreas' | 'Maria', meters: number) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  const lat = marina.lat + meters * 0.000009; // ~1m per 0.000009° lat
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `l-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `l-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

async function assignedBooking(name: 'Andreas' | 'Maria', meters = 30) {
  const { driverId, vehicleId } = await driverAt(name, meters);
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed: ' + a.code);
  return { bookingId: b.id, driverId, vehicleId, revision: a.revision };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
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
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('M3 trip lifecycle', () => {
  it('assignment issues a 4-digit start code', async () => {
    const { bookingId } = await assignedBooking('Andreas');
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(b!.startCode).toMatch(/^\d{4}$/);
  });

  it('full journey: en route → arrive → start(code) → complete + immutable fare', async () => {
    const t = await assignedBooking('Andreas', 20);
    let rev = t.revision;
    const er = await changeStatus({ bookingId: t.bookingId, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId: t.driverId, actorId: 'u' });
    expect(er.ok).toBe(true); if (er.ok) rev = er.revision;

    const ar = await arriveAtPickup(t.bookingId, t.driverId, rev);
    expect(ar.ok).toBe(true); if (ar.ok) rev = ar.revision;
    expect((await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.status).toBe('ARRIVED');
    expect(await prisma.waitingSession.findUnique({ where: { bookingId: t.bookingId } })).not.toBeNull();

    const code = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.startCode!;
    const bad = await startTrip(t.bookingId, t.driverId, rev, '0000' === code ? '1111' : '0000');
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.code).toBe('BAD_START_CODE');

    const st = await startTrip(t.bookingId, t.driverId, rev, code);
    expect(st.ok).toBe(true); if (st.ok) rev = st.revision;
    expect((await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.status).toBe('IN_PROGRESS');

    const co = await completeTrip(t.bookingId, t.driverId, rev);
    expect(co.ok).toBe(true);
    const b = await prisma.booking.findUnique({ where: { id: t.bookingId } });
    expect(b!.status).toBe('COMPLETED');
    const fare = await prisma.fare.findUnique({ where: { bookingId: t.bookingId } });
    expect(fare).not.toBeNull();
    expect(fare!.paymentStatus).toBe('PENDING'); // never auto-collected
    expect(fare!.waitingCents).toBe(0); // regulated mode: no pre-pickup charge
    // Driver is freed.
    expect(await prisma.assignment.findFirst({ where: { activeDriverId: t.driverId } })).toBeNull();
  });

  it('arrive is rejected when the driver is too far from pickup', async () => {
    const t = await assignedBooking('Andreas', 5000); // 5km away
    const er = await changeStatus({ bookingId: t.bookingId, to: 'EN_ROUTE', expectedRevision: t.revision, actor: 'DRIVER', driverId: t.driverId, actorId: 'u' });
    expect(er.ok).toBe(true);
    const rev = er.ok ? er.revision : t.revision;
    const ar = await arriveAtPickup(t.bookingId, t.driverId, rev);
    expect(ar.ok).toBe(false);
    if (!ar.ok) expect(ar.code).toBe('TOO_FAR');
  });

  it('driver pre-pickup cancel rematches (SEARCHING), excludes that driver, keeps the fare snapshot', async () => {
    const t = await assignedBooking('Andreas', 20);
    const fareBefore = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.fareCents;
    const c = await driverCancelPrePickup(t.bookingId, t.driverId, t.revision, 'busy');
    expect(c.ok).toBe(true);
    const b = await prisma.booking.findUnique({ where: { id: t.bookingId } });
    expect(b!.status).toBe('SEARCHING');
    expect(b!.fareCents).toBe(fareBefore); // accepted fare preserved
    const job = await prisma.dispatchJob.findUnique({ where: { bookingId: t.bookingId } });
    expect(job!.triedDriverIds).toContain(t.driverId); // won't be re-offered immediately
    expect(await prisma.assignment.findFirst({ where: { activeDriverId: t.driverId } })).toBeNull();
  });

  it('prolonged pre-pickup GPS loss rematches; IN_PROGRESS is never rematched', async () => {
    const t = await assignedBooking('Andreas', 20);
    // Age the driver's GPS well past the loss threshold.
    await prisma.latestDriverLocation.update({ where: { driverId: t.driverId }, data: { sampledAt: new Date(Date.now() - 10 * 60 * 1000), receivedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.status).toBe('SEARCHING');

    // Now an IN_PROGRESS trip with stale GPS must NOT be rematched.
    const t2 = await assignedBooking('Maria', 20);
    let rev = t2.revision;
    rev = (await changeStatus({ bookingId: t2.bookingId, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId: t2.driverId, actorId: 'u' }) as any).revision;
    rev = (await arriveAtPickup(t2.bookingId, t2.driverId, rev) as any).revision;
    const code = (await prisma.booking.findUnique({ where: { id: t2.bookingId } }))!.startCode!;
    rev = (await startTrip(t2.bookingId, t2.driverId, rev, code) as any).revision;
    await prisma.latestDriverLocation.update({ where: { driverId: t2.driverId }, data: { sampledAt: new Date(Date.now() - 10 * 60 * 1000), receivedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: t2.bookingId } }))!.status).toBe('IN_PROGRESS');
  });
});

describe('M3 scheduled-ride automation', () => {
  async function scheduledBooking(scheduledAt: Date) {
    const ref = `CY-SCH-${++n}`;
    return prisma.booking.create({
      data: {
        reference: ref, pickupLat: marina.lat, pickupLng: marina.lng, pickupLabel: marina.label,
        dropoffLat: lca.lat, dropoffLng: lca.lng, dropoffLabel: lca.label,
        passengerName: 'Sched', phone: '+35799000000', vClass: 'COMFORT', passengerCount: 2,
        status: 'REQUESTED', scheduledAt,
      },
    });
  }

  it('promotes a scheduled ride to SEARCHING once within the lead window', async () => {
    const b = await scheduledBooking(new Date(Date.now() + 10 * 60 * 1000)); // 10 min ahead (< 15 min lead)
    await runOnce();
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after!.status).toBe('SEARCHING');
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).not.toBeNull();
  });

  it('leaves a far-future scheduled ride as REQUESTED', async () => {
    const b = await scheduledBooking(new Date(Date.now() + 3 * 60 * 60 * 1000)); // 3h ahead
    await runOnce();
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after!.status).toBe('REQUESTED');
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
  });
});
