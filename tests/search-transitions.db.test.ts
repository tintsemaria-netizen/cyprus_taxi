import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createBooking } from '@/server/bookings';
import { assignBooking, unassignBooking, changeStatus } from '@/server/assignments';
import { createOffer } from '@/server/dispatch/offers';
import { repairSearchWithoutJob } from '@/server/dispatch/worker';
import type { CreateBookingInput } from '@/lib/validation';

// 2026-10-01 audit: every path into SEARCHING must create a DispatchJob (else the ride waits
// forever) and every path out of it must withdraw the outstanding offer.

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `srch-${RUN}-${++n}`;

async function driver(name: 'Andreas' | 'Maria') {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

async function searchingBooking() {
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('create failed');
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}

async function openOffer(bookingId: string) {
  const { driverId, vehicleId } = await driver('Andreas');
  const o = await createOffer(bookingId, { driverId, vehicleId, distanceMeters: 500, etaSec: 120, etaApproximate: false });
  if (!o) throw new Error('offer not created');
  return { offerId: o.id, driverId };
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
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
});

describe('search transitions keep the worker able to progress every ride', () => {
  it('a new immediate booking gets a job with the CONFIGURED search deadline', async () => {
    const before = Date.now();
    const b = await searchingBooking();
    const job = await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } });
    expect(b.status).toBe('SEARCHING');
    expect(job).not.toBeNull();
    const ms = job!.deadlineAt.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(config.dispatch.searchDeadlineSeconds * 1000 - 2000);
    expect(ms).toBeLessThanOrEqual(config.dispatch.searchDeadlineSeconds * 1000 + 5000);
  });

  it('staff NO_DRIVER → SEARCHING retry creates a dispatch job', async () => {
    const b = await searchingBooking();
    const nd = await changeStatus({ bookingId: b.id, to: 'NO_DRIVER', expectedRevision: b.revision, actor: 'STAFF', actorId: 's' });
    expect(nd.ok).toBe(true);
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
    const re = await changeStatus({ bookingId: b.id, to: 'SEARCHING', expectedRevision: nd.ok ? nd.revision : -1, actor: 'STAFF', actorId: 's' });
    expect(re.ok).toBe(true);
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).not.toBeNull();
  });

  it('passenger cancel during SEARCHING withdraws the open offer and frees the driver', async () => {
    const b = await searchingBooking();
    const { offerId } = await openOffer(b.id);
    const cur = (await prisma.booking.findUnique({ where: { id: b.id } }))!;
    const c = await changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: cur.revision, actor: 'PASSENGER' });
    expect(c.ok).toBe(true);
    const o = await prisma.driverOffer.findUnique({ where: { id: offerId } });
    expect(o!.status).toBe('CANCELED');
    expect(o!.activeDriverId).toBeNull();
    expect(o!.activeBookingId).toBeNull();
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
  });

  it('staff NO_DRIVER during SEARCHING also withdraws the open offer', async () => {
    const b = await searchingBooking();
    const { offerId } = await openOffer(b.id);
    const cur = (await prisma.booking.findUnique({ where: { id: b.id } }))!;
    const r = await changeStatus({ bookingId: b.id, to: 'NO_DRIVER', expectedRevision: cur.revision, actor: 'STAFF', actorId: 's' });
    expect(r.ok).toBe(true);
    expect((await prisma.driverOffer.findUnique({ where: { id: offerId } }))!.status).toBe('CANCELED');
  });

  it('no offer can be created for a booking that is no longer searching', async () => {
    const b = await searchingBooking();
    await changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: b.revision, actor: 'PASSENGER' });
    const { driverId, vehicleId } = await driver('Andreas');
    expect(await createOffer(b.id, { driverId, vehicleId, distanceMeters: 500, etaSec: 120, etaApproximate: false })).toBeNull();
  });

  it('unassigning an immediate ride sends it back to search, excluding the released driver', async () => {
    const b = await searchingBooking();
    const { driverId, vehicleId } = await driver('Maria');
    const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 's', acknowledgeNoGps: true });
    expect(a.ok).toBe(true);
    const u = await unassignBooking({ bookingId: b.id, expectedRevision: a.ok ? a.revision : -1, actorId: 's', reason: 'test' });
    expect(u.ok).toBe(true);
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('SEARCHING');
    const job = await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } });
    expect(job).not.toBeNull();
    expect(job!.triedDriverIds).toContain(driverId);
  });

  it('the worker repairs a SEARCHING booking that has no dispatch job', async () => {
    const b = await searchingBooking();
    await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } }); // simulate a legacy/buggy path
    expect(await repairSearchWithoutJob()).toBeGreaterThanOrEqual(1);
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).not.toBeNull();
    expect(await prisma.bookingEvent.findFirst({ where: { bookingId: b.id, type: 'SEARCH_REPAIRED' } })).not.toBeNull();
  });
});
