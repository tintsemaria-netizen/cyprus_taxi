import { describe, it, expect, beforeAll } from 'vitest';

// Explicit isolated-DB gate: these tests MUST run against a dedicated database
// whose name ends in `_test`. Missing/again-production prerequisites fail loudly
// rather than silently passing.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, reassignBooking, changeStatus } from '@/server/assignments';
import { ingestLocation } from '@/server/location';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `test-${RUN}-${++n}`;

async function readyDriver(name: 'Andreas' | 'Maria') {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture driver ${name} missing (seed the _test DB)`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}
async function freshBookingId() {
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('booking create failed');
  const b = await prisma.booking.findUnique({ where: { reference: r.body.reference } });
  return b!;
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run DB tests: DATABASE_URL database name must end in "_test" (got "${dbName}"). Point at an isolated test DB.`);
  }
  await prisma.$queryRaw`SELECT 1`;
  // Clean transactional tables for a deterministic run (keeps seeded staff/drivers/vehicles).
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
});

describe('idempotency + atomicity', () => {
  it('concurrent same-key requests create ONE booking', async () => {
    const k = key();
    const [r1, r2] = await Promise.all([createBooking(input(), k), createBooking(input(), k)]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.body.reference).toBe(r2.body.reference);
      expect(await prisma.booking.count({ where: { reference: r1.body.reference } })).toBe(1);
    }
  });

  it('same key + different payload => 409', async () => {
    const k = key();
    expect((await createBooking(input(), k)).ok).toBe(true);
    const second = await createBooking({ ...input(), passengerCount: 3 }, k);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it('tracking token is NOT stored in plaintext in the receipt', async () => {
    const r = await createBooking(input(), key());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const receipt = await prisma.idempotencyReceipt.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(receipt?.responseJson.startsWith('v1:')).toBe(true); // AEAD-encrypted
    expect(receipt?.responseJson.includes(r.body.tracking.token)).toBe(false);
  });
});

describe('assignment + status concurrency', () => {
  it('full lifecycle persists and frees the driver', async () => {
    const { driverId, vehicleId } = await readyDriver('Andreas');
    const b = await freshBookingId();
    let rev = b.revision;
    const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: rev, actorId: 't', acknowledgeNoGps: true });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    rev = a.revision;
    for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] as const) {
      const r = await changeStatus({ bookingId: b.id, to, expectedRevision: rev, actor: 'STAFF', actorId: 't' });
      expect(r.ok).toBe(true);
      if (r.ok) rev = r.revision;
    }
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('COMPLETED');
    expect(await prisma.assignment.findFirst({ where: { activeDriverId: driverId } })).toBeNull();
  });

  it('generic status change cannot fabricate ASSIGNED', async () => {
    const b = await freshBookingId();
    const r = await changeStatus({ bookingId: b.id, to: 'ASSIGNED', expectedRevision: b.revision, actor: 'STAFF', actorId: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('USE_ASSIGN');
    // booking remains REQUESTED with no assignment
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('REQUESTED');
  });

  it('two concurrent assigns of one driver: exactly one wins', async () => {
    const { driverId, vehicleId } = await readyDriver('Maria');
    const b1 = await freshBookingId();
    const b2 = await freshBookingId();
    const [a1, a2] = await Promise.all([
      assignBooking({ bookingId: b1.id, driverId, vehicleId, expectedRevision: b1.revision, actorId: 't1', acknowledgeNoGps: true }),
      assignBooking({ bookingId: b2.id, driverId, vehicleId, expectedRevision: b2.revision, actorId: 't2', acknowledgeNoGps: true }),
    ]);
    expect([a1, a2].filter((r) => r.ok).length).toBe(1);
    await prisma.assignment.updateMany({ where: { activeDriverId: driverId }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  });

  it('competing revisions: two status changes with same expectedRevision, one 409', async () => {
    const { driverId, vehicleId } = await readyDriver('Andreas');
    const b = await freshBookingId();
    const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const [r1, r2] = await Promise.all([
      changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'STAFF', actorId: 't' }),
      changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: a.revision, actor: 'STAFF', actorId: 't' }),
    ]);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    expect(okCount).toBe(1);
    const loser = [r1, r2].find((r) => !r.ok);
    if (loser && !loser.ok) expect(loser.status).toBe(409);
    await prisma.assignment.updateMany({ where: { activeDriverId: driverId }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  });

  it('failed reassignment rolls back: old assignment, driver and revision preserved', async () => {
    const a1 = await readyDriver('Andreas');
    const b = await freshBookingId();
    const asg = await assignBooking({ bookingId: b.id, driverId: a1.driverId, vehicleId: a1.vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    expect(asg.ok).toBe(true);
    if (!asg.ok) return;
    const revAfterAssign = asg.revision;

    // Target a driver that is NOT on duty → reassignment must fail and roll back.
    const other = await prisma.driver.findFirst({ where: { publicName: 'Petros' }, include: { bindings: { where: { endedAt: null } } } });
    if (other) await prisma.driver.update({ where: { id: other.id }, data: { onDuty: false, available: false } });
    const res = await reassignBooking({
      bookingId: b.id, driverId: other!.id, vehicleId: other!.bindings[0].vehicleId,
      expectedRevision: revAfterAssign, actorId: 't', reason: 'try move', acknowledgeNoGps: true,
    });
    expect(res.ok).toBe(false);

    // The ORIGINAL assignment (Andreas) must still be active and revision unchanged.
    const stillActive = await prisma.assignment.findFirst({ where: { activeBookingId: b.id } });
    expect(stillActive?.driverId).toBe(a1.driverId);
    const bookingNow = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(bookingNow!.revision).toBe(revAfterAssign);
    expect(bookingNow!.status).toBe('ASSIGNED');
    await prisma.assignment.updateMany({ where: { activeDriverId: a1.driverId }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  });
});

describe('GPS ingestion', () => {
  it('on-duty driver may share GPS before assignment; off-duty is rejected; older sample rejected', async () => {
    const d = await prisma.driver.findFirst({ where: { publicName: 'Maria' } });
    if (!d) throw new Error('fixture missing');
    await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    await prisma.latestDriverLocation.deleteMany({ where: { driverId: d.id } });
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });

    const now = Date.now();
    const s1 = await ingestLocation(d.id, { lat: 34.67, lng: 33.04, accuracyM: 10, sampledAt: new Date(now).toISOString(), gpsSession: 'sess-A', sequence: 1 });
    expect(s1.ok).toBe(true); // accepted with NO active assignment (fleet visibility)

    const older = await ingestLocation(d.id, { lat: 34.60, lng: 33.00, accuracyM: 10, sampledAt: new Date(now - 20000).toISOString(), gpsSession: 'sess-B', sequence: 1 });
    expect(older.ok).toBe(false); // older timestamp across a new session is rejected

    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
    const off = await ingestLocation(d.id, { lat: 34.68, lng: 33.05, accuracyM: 10, sampledAt: new Date(now + 5000).toISOString(), gpsSession: 'sess-A', sequence: 2 });
    expect(off.ok).toBe(false); // off-duty rejected
    if (!off.ok) expect(off.code).toBe('OFF_DUTY');
  });
});
