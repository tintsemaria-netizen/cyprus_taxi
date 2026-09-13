/**
 * Isolated dispatch load test (Task 012 §8). Runs against an ISOLATED *_test database
 * with external providers stubbed (Google not configured → haversine ETA). Seeds a driver
 * fixture, fires many concurrent bookings, then drives the worker and simulates instant
 * driver acceptance, asserting invariants and reporting p50/p95 assignment latency.
 *
 * Usage: DATABASE_URL=...taxi_cyprus_test... LOAD_DRIVERS=120 LOAD_BOOKINGS=100 tsx scripts/load-test.ts
 * These are TEST targets on this hardware, not a claim of production capacity.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer } from '@/server/dispatch/offers';
import type { CreateBookingInput } from '@/lib/validation';

const dbName = (() => { try { return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) { console.error(`Refusing to load-test: DATABASE_URL must end in _test (got "${dbName}").`); process.exit(1); }

const DRIVERS = Number(process.env.LOAD_DRIVERS || 120);
const BOOKINGS = Number(process.env.LOAD_BOOKINGS || 100);
const BASE = { lat: 34.6706, lng: 33.0413 }; // Limassol
const DROP = { lat: 34.8751, lng: 33.6249 }; // Larnaca airport

function jitter(deg: number) { return (Math.random() - 0.5) * deg; }
const pct = (arr: number[], p: number) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

async function cleanup() {
  await prisma.fare.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.driverVehicleBinding.deleteMany({ where: { vehicle: { plate: { startsWith: 'LT-' } } } });
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.driver.deleteMany({ where: { user: { login: { startsWith: 'load-' } } } });
  await prisma.vehicle.deleteMany({ where: { plate: { startsWith: 'LT-' } } });
  await prisma.staffUser.deleteMany({ where: { login: { startsWith: 'load-' } } });
}

async function seedDrivers(count: number) {
  const now = new Date();
  const users: { id: string; login: string; role: 'DRIVER'; passwordHash: string; active: boolean; displayName: string }[] = [];
  const vehicles: { id: string; plate: string; make: string; model: string; color: string; vClass: 'COMFORT'; seats: number; active: boolean }[] = [];
  const drivers: { id: string; userId: string; publicName: string; phone: string; active: boolean; onDuty: boolean; available: boolean }[] = [];
  const bindings: { id: string; driverId: string; vehicleId: string; activeDriverId: string; activeVehicleId: string }[] = [];
  const locations: { driverId: string; lat: number; lng: number; accuracyM: number; sampledAt: Date; receivedAt: Date; gpsSession: string; sequence: number }[] = [];
  for (let i = 0; i < count; i++) {
    const uid = randomUUID(), did = randomUUID(), vid = randomUUID();
    users.push({ id: uid, login: `load-${i}-${uid.slice(0, 8)}`, role: 'DRIVER', passwordHash: 'loadtest-nohash', active: true, displayName: `LoadDriver${i}` });
    vehicles.push({ id: vid, plate: `LT-${i}-${vid.slice(0, 4)}`, make: 'Test', model: 'Car', color: 'Black', vClass: 'COMFORT', seats: 4, active: true });
    drivers.push({ id: did, userId: uid, publicName: `LoadDriver${i}`, phone: `+357999${String(i).padStart(5, '0')}`, active: true, onDuty: true, available: true });
    bindings.push({ id: randomUUID(), driverId: did, vehicleId: vid, activeDriverId: did, activeVehicleId: vid });
    locations.push({ driverId: did, lat: BASE.lat + jitter(0.04), lng: BASE.lng + jitter(0.04), accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `load-${i}`, sequence: 1 });
  }
  await prisma.staffUser.createMany({ data: users });
  await prisma.vehicle.createMany({ data: vehicles });
  await prisma.driver.createMany({ data: drivers });
  await prisma.driverVehicleBinding.createMany({ data: bindings });
  await prisma.latestDriverLocation.createMany({ data: locations });
}

const bInput = (): CreateBookingInput => ({
  pickup: { lat: BASE.lat + jitter(0.03), lng: BASE.lng + jitter(0.03), label: 'Load pickup' },
  dropoff: { lat: DROP.lat, lng: DROP.lng, label: 'Larnaca Airport (LCA)' },
  when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Load', phone: '+35799123456',
} as CreateBookingInput);

async function main() {
  console.log(`[load] cleaning + seeding ${DRIVERS} drivers…`);
  await cleanup();
  await seedDrivers(DRIVERS);

  console.log(`[load] firing ${BOOKINGS} concurrent bookings…`);
  const t0 = Date.now();
  const created = await Promise.all(
    Array.from({ length: BOOKINGS }, (_, i) => createBooking(bInput(), `load-${t0}-${i}`).then((r) => ({ r, at: Date.now() }))),
  );
  const createdOk = created.filter((c) => c.r.ok).length;
  const createMs = Date.now() - t0;
  const startAt = new Map<string, number>();
  for (const c of created) if (c.r.ok) startAt.set(c.r.body.bookingId, t0);

  console.log(`[load] ${createdOk}/${BOOKINGS} bookings created in ${createMs}ms; running dispatch + simulated instant accept…`);
  const assignLatency: number[] = [];
  const assignedAt = new Set<string>();
  const maxIters = 400;
  let iter = 0;
  for (; iter < maxIters; iter++) {
    await runOnce();
    // Simulate instant driver acceptance of every live offer.
    const offers = await prisma.driverOffer.findMany({ where: { status: 'OFFERED' }, select: { id: true, driverId: true, bookingId: true } });
    for (const o of offers) {
      const res = await acceptOffer(o.id, o.driverId);
      if (res.ok && !assignedAt.has(o.bookingId)) {
        assignedAt.add(o.bookingId);
        assignLatency.push(Date.now() - (startAt.get(o.bookingId) ?? Date.now()));
      }
    }
    const remaining = await prisma.booking.count({ where: { status: 'SEARCHING' } });
    if (remaining === 0) break;
  }

  // ---- Invariants ----
  const violations: string[] = [];
  const dupDriver = await prisma.$queryRawUnsafe<{ activeDriverId: string; c: bigint }[]>(
    `SELECT "activeDriverId", COUNT(*) c FROM "Assignment" WHERE "activeDriverId" IS NOT NULL GROUP BY "activeDriverId" HAVING COUNT(*) > 1`);
  if (dupDriver.length) violations.push(`${dupDriver.length} drivers with >1 active assignment`);
  const dupBooking = await prisma.$queryRawUnsafe<{ activeBookingId: string; c: bigint }[]>(
    `SELECT "activeBookingId", COUNT(*) c FROM "Assignment" WHERE "activeBookingId" IS NOT NULL GROUP BY "activeBookingId" HAVING COUNT(*) > 1`);
  if (dupBooking.length) violations.push(`${dupBooking.length} bookings with >1 active assignment`);

  const assigned = await prisma.booking.count({ where: { status: 'ASSIGNED' } });
  const noDriver = await prisma.booking.count({ where: { status: 'NO_DRIVER' } });
  const searching = await prisma.booking.count({ where: { status: 'SEARCHING' } });
  const activeAssignments = await prisma.assignment.count({ where: { activeBookingId: { not: null } } });
  if (assigned > DRIVERS) violations.push(`assigned (${assigned}) exceeds driver supply (${DRIVERS})`);

  console.log('\n===== LOAD TEST RESULT =====');
  console.log(`drivers seeded:        ${DRIVERS}`);
  console.log(`bookings submitted:    ${BOOKINGS} (created OK: ${createdOk})`);
  console.log(`concurrent create p50/p95: n/a (single batch ${createMs}ms wall)`);
  console.log(`dispatch iterations:   ${iter}`);
  console.log(`ASSIGNED:              ${assigned}`);
  console.log(`NO_DRIVER:             ${noDriver}`);
  console.log(`still SEARCHING:       ${searching}`);
  console.log(`active assignments:    ${activeAssignments}`);
  console.log(`assign latency p50/p95/max ms: ${pct(assignLatency, 50)} / ${pct(assignLatency, 95)} / ${assignLatency.length ? Math.max(...assignLatency) : 0}`);
  console.log(`INVARIANT VIOLATIONS:  ${violations.length ? violations.join('; ') : 'NONE'}`);
  console.log('============================\n');

  await cleanup();
  await prisma.$disconnect();
  process.exit(violations.length ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
