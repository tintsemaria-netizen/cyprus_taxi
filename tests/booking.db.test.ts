import { describe, it, expect, beforeAll } from 'vitest';

// Load .env for DATABASE_URL before importing anything that builds a Prisma client.
try { (process as unknown as { loadEnvFile: (p?: string) => void }).loadEnvFile('.env'); } catch { /* env already set */ }

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };

function input(): CreateBookingInput {
  return {
    pickup: marina,
    dropoff: lca,
    when: 'NOW',
    vClass: 'COMFORT',
    passengerCount: 2,
    passengerName: 'Test Passenger',
    phone: '+35799123456',
  } as CreateBookingInput;
}

let ok = true;
beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    ok = false;
    console.warn('DB not reachable — skipping DB tests');
  }
});

describe('booking service (DB-backed)', () => {
  it('idempotent: concurrent same-key requests create ONE booking', async () => {
    if (!ok) return;
    const key = `test-${Date.now()}-a`;
    const [r1, r2] = await Promise.all([createBooking(input(), key), createBooking(input(), key)]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.body.reference).toBe(r2.body.reference);
      const count = await prisma.booking.count({ where: { reference: r1.body.reference } });
      expect(count).toBe(1);
    }
  });

  it('same key + different payload => conflict', async () => {
    if (!ok) return;
    const key = `test-${Date.now()}-b`;
    const first = await createBooking(input(), key);
    expect(first.ok).toBe(true);
    const changed = { ...input(), passengerCount: 3 };
    const second = await createBooking(changed, key);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it('full lifecycle REQUESTED..COMPLETED persists', async () => {
    if (!ok) return;
    // Prepare a driver: andreas on duty + available, bound to their vehicle (from seed).
    const driver = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    if (!driver) return;
    await prisma.driver.update({ where: { id: driver.id }, data: { onDuty: true, available: true, active: true } });
    // ensure no leftover active assignment
    await prisma.assignment.updateMany({ where: { activeDriverId: driver.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    const vehicleId = driver.bindings[0]?.vehicleId;
    if (!vehicleId) return;

    const created = await createBooking(input(), `test-${Date.now()}-life`);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const b = await prisma.booking.findUnique({ where: { reference: created.body.reference } });
    expect(b).toBeTruthy();
    let rev = b!.revision;

    const a = await assignBooking({ bookingId: b!.id, driverId: driver.id, vehicleId, expectedRevision: rev, actorId: 'test', acknowledgeNoGps: true });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    rev = a.revision;

    for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] as const) {
      const r = await changeStatus({ bookingId: b!.id, to, expectedRevision: rev, actor: 'STAFF', actorId: 'test' });
      expect(r.ok).toBe(true);
      if (r.ok) rev = r.revision;
    }
    const final = await prisma.booking.findUnique({ where: { id: b!.id } });
    expect(final!.status).toBe('COMPLETED');
    // Driver freed and no active assignment remains.
    const active = await prisma.assignment.findFirst({ where: { activeDriverId: driver.id } });
    expect(active).toBeNull();
  });

  it('two concurrent assigns of the same driver: exactly one wins', async () => {
    if (!ok) return;
    const driver = await prisma.driver.findFirst({ where: { publicName: 'Maria' }, include: { bindings: { where: { endedAt: null } } } });
    if (!driver || !driver.bindings[0]) return;
    await prisma.driver.update({ where: { id: driver.id }, data: { onDuty: true, available: true, active: true } });
    await prisma.assignment.updateMany({ where: { activeDriverId: driver.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    const vehicleId = driver.bindings[0].vehicleId;

    const c1 = await createBooking(input(), `test-${Date.now()}-c1`);
    const c2 = await createBooking(input(), `test-${Date.now()}-c2`);
    if (!c1.ok || !c2.ok) return;
    const b1 = await prisma.booking.findUnique({ where: { reference: c1.body.reference } });
    const b2 = await prisma.booking.findUnique({ where: { reference: c2.body.reference } });

    const [a1, a2] = await Promise.all([
      assignBooking({ bookingId: b1!.id, driverId: driver.id, vehicleId, expectedRevision: b1!.revision, actorId: 't1', acknowledgeNoGps: true }),
      assignBooking({ bookingId: b2!.id, driverId: driver.id, vehicleId, expectedRevision: b2!.revision, actorId: 't2', acknowledgeNoGps: true }),
    ]);
    const wins = [a1, a2].filter((r) => r.ok).length;
    expect(wins).toBe(1);
    // cleanup
    await prisma.assignment.updateMany({ where: { activeDriverId: driver.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  });
});
