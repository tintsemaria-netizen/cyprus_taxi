import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip, driverCancelPrePickup, driverNoShow } from '@/server/dispatch/lifecycle';
import { passengerSetStartCode } from '@/server/passenger-start-code';
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
  await prisma.passengerRating.deleteMany({});
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('M3 trip lifecycle', () => {
  it('assignment issues no start code by default; the passenger can switch one on and off', async () => {
    const { bookingId } = await assignedBooking('Andreas');
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))!.startCode).toBeNull();
    const on = await passengerSetStartCode(bookingId, true);
    expect(on.ok && on.startCode).toMatch(/^\d{4}$/);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))!.startCode).toMatch(/^\d{4}$/);
    const off = await passengerSetStartCode(bookingId, false);
    expect(off.ok && off.startCode).toBeNull();
    expect(await prisma.bookingEvent.count({ where: { bookingId, type: { in: ['START_CODE_ON', 'START_CODE_OFF'] } } })).toBe(2);
  });

  it('without a code the driver starts with one tap; the code cannot be changed once the trip started', async () => {
    const t = await assignedBooking('Andreas', 20);
    let rev = t.revision;
    const er = await changeStatus({ bookingId: t.bookingId, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId: t.driverId, actorId: 'u' });
    if (er.ok) rev = er.revision;
    const ar = await arriveAtPickup(t.bookingId, t.driverId, rev); if (ar.ok) rev = ar.revision;
    const st = await startTrip(t.bookingId, t.driverId, rev, '');
    expect(st.ok).toBe(true);
    const late = await passengerSetStartCode(t.bookingId, true);
    expect(late.ok).toBe(false); if (!late.ok) expect(late.code).toBe('BAD_STATE');
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

    const on = await passengerSetStartCode(t.bookingId, true); // passenger switched the code on
    const code = on.ok ? on.startCode! : '';
    rev = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.revision;
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

  it('the passenger is told what to pay: a «ride.completed» push and the amount on the finished screen (2026-11-26)', async () => {
    const t = await assignedBooking('Andreas', 20);
    let rev = t.revision;
    const er = await changeStatus({ bookingId: t.bookingId, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId: t.driverId, actorId: 'u' });
    if (er.ok) rev = er.revision;
    const ar = await arriveAtPickup(t.bookingId, t.driverId, rev); expect(ar).toMatchObject({ ok: true }); if (ar.ok) rev = ar.revision;
    const st = await startTrip(t.bookingId, t.driverId, rev, ''); expect(st).toMatchObject({ ok: true }); if (st.ok) rev = st.revision;
    const b0 = await prisma.booking.findUnique({ where: { id: t.bookingId } });
    // The driver typed the taximeter amount at «Завершить»: that is what the passenger pays.
    const co = await completeTrip(t.bookingId, t.driverId, rev, 7250); expect(co).toMatchObject({ ok: true });
    const push = await prisma.notificationOutbox.findFirst({ where: { audience: `PASSENGER:${t.bookingId}`, dedupeKey: `done-${t.bookingId}` } });
    expect(push).not.toBeNull();
    const fixed = b0!.priceType === 'REGULATED_FIXED' || b0!.priceType === 'SHARED_FIXED';
    const want = fixed ? b0!.fareCents : 7250;
    expect(push!.msg).toEqual({ k: 'ride.completed', p: { totalC: want } });
    const { trackingView } = await import('@/server/views');
    const v = await trackingView(t.bookingId);
    expect(v && 'receipt' in v ? v.receipt?.totalCents : null).toBe(want);
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

  it('no-show (2026-11-27): only after 3 free + 2 paid minutes; closes the ride — no rematch, not the driver\'s refusal', async () => {
    const t = await assignedBooking('Andreas', 20);
    expect((await changeStatus({ bookingId: t.bookingId, to: 'EN_ROUTE', expectedRevision: t.revision, actor: 'DRIVER', driverId: t.driverId })).ok).toBe(true);
    let b = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!;
    expect((await arriveAtPickup(t.bookingId, t.driverId, b.revision)).ok).toBe(true);
    b = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!;
    // 4 minutes after arrival: still too early.
    await prisma.waitingSession.update({ where: { bookingId: t.bookingId }, data: { arrivedAt: new Date(Date.now() - 4 * 60_000) } });
    const early = await driverNoShow(t.bookingId, t.driverId, b.revision);
    expect(early.ok ? '' : early.code).toBe('TOO_EARLY');
    await prisma.waitingSession.update({ where: { bookingId: t.bookingId }, data: { arrivedAt: new Date(Date.now() - 5 * 60_000 - 1000) } });
    const ns = await driverNoShow(t.bookingId, t.driverId, b.revision);
    expect(ns.ok && ns.extra).toEqual({ noShowFeeCents: 400 });
    b = (await prisma.booking.findUnique({ where: { id: t.bookingId } }))!;
    expect(b.status).toBe('CANCELED');
    expect(b.lateCancelFeeCents).toBeNull(); // cash: recorded in the event only, never charged
    expect(await prisma.bookingEvent.findFirst({ where: { bookingId: t.bookingId, type: 'REMATCH' } })).toBeNull();
    expect((await prisma.bookingEvent.findFirst({ where: { bookingId: t.bookingId, type: 'NO_SHOW' } }))?.reason).toContain('not charged');
    expect(await prisma.assignment.findFirst({ where: { activeDriverId: t.driverId } })).toBeNull();
    expect((await prisma.driver.findUnique({ where: { id: t.driverId } }))!.available).toBe(true);
  });

  it('prolonged pre-pickup GPS loss rematches; IN_PROGRESS is never rematched', async () => {
    const t = await assignedBooking('Andreas', 20);
    // Age the driver's GPS well past the loss threshold.
    await prisma.latestDriverLocation.update({ where: { driverId: t.driverId }, data: { sampledAt: new Date(Date.now() - 10 * 60 * 1000), receivedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: t.bookingId } }))!.status).toBe('SEARCHING');
    // The driver who lost it is told why, in his language (launch fixes §5, ported 2026-11-23).
    const u = await prisma.driver.findUniqueOrThrow({ where: { id: t.driverId }, select: { userId: true } });
    const lost = await prisma.notificationOutbox.findFirst({ where: { audience: `DRIVER:${u.userId}`, tag: `lost-${t.bookingId}` } });
    expect((lost?.msg as { k: string } | null)?.k).toBe('drv.rideLostGps');

    // Now an IN_PROGRESS trip with stale GPS must NOT be rematched.
    const t2 = await assignedBooking('Maria', 20);
    let rev = t2.revision;
    const revOf = (r: object) => ('revision' in r && typeof r.revision === 'number' ? r.revision : -1);
    rev = revOf(await changeStatus({ bookingId: t2.bookingId, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId: t2.driverId, actorId: 'u' }));
    rev = revOf(await arriveAtPickup(t2.bookingId, t2.driverId, rev));
    const code = (await prisma.booking.findUnique({ where: { id: t2.bookingId } }))!.startCode!;
    await startTrip(t2.bookingId, t2.driverId, rev, code);
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
