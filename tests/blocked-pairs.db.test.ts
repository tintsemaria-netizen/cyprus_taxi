import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Isolated-DB gate (same contract as booking.db.test.ts).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import { listFreeOrders, claimFreeOrder } from '@/server/dispatch/free-orders';
import { isPairBlocked } from '@/server/dispatch/blocked-pairs';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Pax', phone: '+35799123456' } as CreateBookingInput);
let n = 0; const RUN = `${Date.now()}`; const key = () => `blk-${RUN}-${++n}`;

async function placeDriver(name: 'Andreas' | 'Maria', km: number) {
  const d = await prisma.driver.findFirstOrThrow({ where: { publicName: name } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date(); const lat = marina.lat + km * 0.009;
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n }, create: { driverId: d.id, lat, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n } });
  return d.id;
}
async function booking(passengerId: string) {
  const r = await createBooking(input(), key(), undefined, passengerId);
  if (!r.ok) throw new Error('create');
  return prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
}
// A finished earlier ride between the two, rated `stars` by `who`.
async function rated(who: 'passenger' | 'driver', driverId: string, passengerId: string, stars: number) {
  const past = await booking(passengerId);
  await prisma.dispatchJob.deleteMany({ where: { bookingId: past.id } });
  await prisma.booking.update({ where: { id: past.id }, data: { status: 'COMPLETED' } });
  if (who === 'passenger') await prisma.tripRating.create({ data: { bookingId: past.id, driverId, passengerId, stars } });
  else await prisma.passengerRating.create({ data: { bookingId: past.id, driverId, passengerId, stars } });
}
async function offerDriverFor(bookingId: string) {
  await runOnce();
  return (await prisma.driverOffer.findFirst({ where: { bookingId, status: 'OFFERED' } }))?.driverId ?? null;
}

let paxId = '';
beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`);
  await prisma.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  for (const m of ['chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'latestDriverLocation', 'idempotencyReceipt', 'passengerRating', 'tripRating'] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
  await prisma.preAssignment.deleteMany({});
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) await prisma.driver.updateMany({ where: { publicName: name }, data: { onDuty: false, available: false } });
  paxId = (await prisma.passenger.create({ data: { email: `blk-${RUN}-${++n}@example.com`, name: 'Pax' } })).id;
});

describe('1-star rating blocks a driver–passenger pair for good', () => {
  it('passenger gave the driver 1 star → the nearest driver is skipped', async () => {
    const andreas = await placeDriver('Andreas', 1); const maria = await placeDriver('Maria', 3);
    await rated('passenger', andreas, paxId, 1);
    const b = await booking(paxId);
    expect(await offerDriverFor(b.id)).toBe(maria);
  });

  it('driver gave the passenger 1 star → skipped too', async () => {
    const andreas = await placeDriver('Andreas', 1); const maria = await placeDriver('Maria', 3);
    await rated('driver', andreas, paxId, 1);
    expect(await isPairBlocked(andreas, paxId)).toBe(true);
    const b = await booking(paxId);
    expect(await offerDriverFor(b.id)).toBe(maria);
  });

  it('2 stars does not block; other passengers are not affected', async () => {
    const andreas = await placeDriver('Andreas', 1); await placeDriver('Maria', 3);
    await rated('passenger', andreas, paxId, 2);
    expect(await offerDriverFor((await booking(paxId)).id)).toBe(andreas);
    const other = (await prisma.passenger.create({ data: { email: `blk-o-${RUN}-${++n}@example.com` } })).id;
    await rated('driver', andreas, other, 1);
    await prisma.driverOffer.deleteMany({}); await prisma.dispatchJob.deleteMany({});
    expect(await isPairBlocked(andreas, paxId)).toBe(false);
  });

  it('a rating that lands while the offer is open makes the accept fail', async () => {
    const andreas = await placeDriver('Andreas', 1);
    const b = await booking(paxId);
    expect(await offerDriverFor(b.id)).toBe(andreas);
    const offer = await getDriverActiveOffer(andreas);
    await rated('driver', andreas, paxId, 1);
    const r = await acceptOffer(offer!.offerId, andreas);
    expect(r.ok).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('SEARCHING');
  });

  it('free orders: hidden from the blocked driver and the claim is refused', async () => {
    const andreas = await placeDriver('Andreas', 1);
    await rated('passenger', andreas, paxId, 1);
    const b = await booking(paxId);
    await prisma.dispatchJob.update({ where: { bookingId: b.id }, data: { openedAt: new Date(), deadlineAt: new Date(Date.now() + 600_000) } });
    expect((await listFreeOrders(andreas)).some((o) => o.bookingId === b.id)).toBe(false);
    const r = await claimFreeOrder(b.id, andreas);
    expect(r.ok).toBe(false);
  });
});
