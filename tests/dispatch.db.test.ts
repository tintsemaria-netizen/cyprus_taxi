import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Isolated-DB gate (same contract as booking.db.test.ts).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, rejectOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;
const key = () => `disp-${RUN}-${++n}`;

// Place a driver on duty with a fresh GPS fix `km` roughly north of the pickup.
async function placeDriver(name: 'Andreas' | 'Maria' | 'Petros', km: number, onDuty = true) {
  const d = await prisma.driver.findFirst({ where: { publicName: name } });
  if (!d) throw new Error(`fixture driver ${name} missing (seed the _test DB)`);
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty, available: onDuty, active: true } });
  const now = new Date();
  const lat = marina.lat + km * 0.009; // ~1km per 0.009° latitude
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n },
  });
  return d.id;
}

async function offDuty(name: string) {
  const d = await prisma.driver.findFirst({ where: { publicName: name } });
  if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
}

async function newSearchingBooking() {
  const r = await createBooking(input(), key());
  if (!r.ok) throw new Error('booking create failed');
  const b = await prisma.booking.findUnique({ where: { reference: r.body.reference } });
  return b!;
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run DB tests: DATABASE_URL database name must end in "_test" (got "${dbName}").`);
  }
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  // Clean transactional + dispatch tables (respect FKs: children before bookings).
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
  for (const name of ['Andreas', 'Maria', 'Petros']) await offDuty(name);
});

describe('autonomous dispatch worker', () => {
  it('creates a booking in SEARCHING with a dispatch job', async () => {
    const b = await newSearchingBooking();
    expect(b.status).toBe('SEARCHING');
    const job = await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } });
    expect(job).not.toBeNull();
  });

  it('happy path: offer → accept → ASSIGNED', async () => {
    const driverId = await placeDriver('Andreas', 1);
    const b = await newSearchingBooking();
    await runOnce();
    const offer = await getDriverActiveOffer(driverId);
    expect(offer).not.toBeNull();
    const res = await acceptOffer(offer!.offerId, driverId);
    expect(res.ok).toBe(true);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after!.status).toBe('ASSIGNED');
    // Dispatch job cleared, an active assignment exists for this driver.
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
    expect(await prisma.assignment.findFirst({ where: { activeDriverId: driverId, activeBookingId: b.id } })).not.toBeNull();
  });

  it('nearest driver is offered first; reject → next candidate offered', async () => {
    const near = await placeDriver('Andreas', 1); // ~1km
    const far = await placeDriver('Maria', 2); // ~2km
    await newSearchingBooking();

    await runOnce();
    const firstNear = await getDriverActiveOffer(near);
    const firstFar = await getDriverActiveOffer(far);
    expect(firstNear).not.toBeNull(); // nearest wins
    expect(firstFar).toBeNull();

    const rej = await rejectOffer(firstNear!.offerId, near);
    expect(rej.ok).toBe(true);

    await runOnce();
    const secondFar = await getDriverActiveOffer(far);
    const secondNear = await getDriverActiveOffer(near);
    expect(secondFar).not.toBeNull(); // fell through to the next driver
    expect(secondNear).toBeNull(); // rejected driver not re-offered
  });

  it('expired offer is released and the next candidate is offered', async () => {
    const near = await placeDriver('Andreas', 1);
    const far = await placeDriver('Maria', 2);
    const b = await newSearchingBooking();

    await runOnce();
    const first = await getDriverActiveOffer(near);
    expect(first).not.toBeNull();

    // Force the offer to have expired.
    await prisma.driverOffer.update({ where: { id: first!.offerId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await runOnce(); // expires Andreas' offer, then offers Maria
    const gone = await prisma.driverOffer.findUnique({ where: { id: first!.offerId } });
    expect(gone!.status).toBe('EXPIRED');
    const nextFar = await getDriverActiveOffer(far);
    expect(nextFar).not.toBeNull();
    expect(nextFar!.pickup).toBeDefined();
    // The job remembers the tried (expired) driver.
    const job = await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } });
    expect(job!.triedDriverIds).toContain(near);
  });

  it('no eligible driver + deadline passed → NO_DRIVER', async () => {
    const b = await newSearchingBooking(); // nobody on duty
    await prisma.dispatchJob.update({ where: { bookingId: b.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    await runOnce();
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(after!.status).toBe('NO_DRIVER');
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
  });

  it('concurrency: one driver, two searching bookings → only one offer exists', async () => {
    await placeDriver('Andreas', 1);
    await newSearchingBooking();
    await newSearchingBooking();
    await runOnce();
    const outstanding = await prisma.driverOffer.count({ where: { status: 'OFFERED' } });
    expect(outstanding).toBe(1); // the single driver is reserved for exactly one booking
  });

  it('accept is atomic: a second driver cannot accept an already-assigned booking', async () => {
    const near = await placeDriver('Andreas', 1);
    const far = await placeDriver('Maria', 2);
    const b = await newSearchingBooking();
    await runOnce();
    const offer = await getDriverActiveOffer(near);
    expect(offer).not.toBeNull();
    const ok = await acceptOffer(offer!.offerId, near);
    expect(ok.ok).toBe(true);

    // Fabricate a stale offer to the far driver for the same booking and try to accept.
    const stale = await prisma.driverOffer.create({
      data: { bookingId: b.id, driverId: far, vehicleId: (await vehicleOf(far)), status: 'OFFERED', expiresAt: new Date(Date.now() + 20000) },
    });
    const second = await acceptOffer(stale.id, far);
    expect(second.ok).toBe(false); // booking already ASSIGNED
  });
});

async function vehicleOf(driverId: string): Promise<string> {
  const bind = await prisma.driverVehicleBinding.findFirst({ where: { driverId, endedAt: null } });
  if (!bind) throw new Error('no binding');
  return bind.vehicleId;
}
