import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Next order for a driver finishing a trip (2026-11-25, operator): offered when he drops his passenger off within
// 5 min (7 min when the new client is within 1 km of that drop-off); taken as his NEXT ride, which starts when the
// current trip ends. Straight-line road times here (no Google in tests): 40 km/h.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import { completeTrip } from '@/server/dispatch/lifecycle';
import { trackingView, driverCurrentTrip } from '@/server/views';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const D = { lat: 34.6906, lng: 33.0413, label: 'Drop-off D' }; // ~2.2 km north of the marina
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;
const key = () => `next-${RUN}-${++n}`;
const inp = (p: typeof marina, d: typeof marina): CreateBookingInput => ({ pickup: p, dropoff: d, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Nx', phone: '+35799123456' } as CreateBookingInput);

async function at(name: string, lat: number, lng: number) {
  const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat, lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `n-${RUN}`, sequence: ++n }, create: { driverId: d.id, lat, lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `n-${RUN}`, sequence: ++n } });
  return d.id;
}
async function book(p: typeof marina, d: typeof marina) {
  const r = await createBooking(inp(p, d), key());
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}
// Andreas carries a passenger to D and is `kmLeft` km before it.
async function andreasOnTrip(kmLeft: number) {
  const a = await at('Andreas', marina.lat + 0.001, marina.lng);
  const b1 = await book(marina, D);
  await runOnce();
  const o = await getDriverActiveOffer(a);
  expect((await acceptOffer(o!.offerId, a)).ok).toBe(true);
  await prisma.booking.update({ where: { id: b1.id }, data: { status: 'IN_PROGRESS' } });
  await at('Andreas', D.lat - kmLeft * 0.009, D.lng);
  return { a, b1: (await prisma.booking.findUnique({ where: { id: b1.id } }))! };
}

beforeAll(async () => { if (!dbName.endsWith('_test')) throw new Error('Refusing: DB name must end in _test'); });
async function cleanup() {
  for (const t of ['chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'latestDriverLocation', 'idempotencyReceipt', 'passengerRating', 'driverSettlement'] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
  await prisma.booking.deleteMany({});
  await prisma.driver.updateMany({ where: { publicName: { in: ['Andreas', 'Maria', 'Petros'] } }, data: { onDuty: false, available: false } });
}
beforeEach(cleanup);

describe('next order for a driver finishing a trip', () => {
  it('2 min before the drop-off he beats a free driver 6 km away; accepted = his next ride; trip end → on the way', async () => {
    const { a, b1 } = await andreasOnTrip(1.4); // ~2 min left
    const m = await at('Maria', D.lat + 0.054, D.lng + 0.0044); // ~6 km from the new client
    const b2 = await book({ lat: D.lat, lng: D.lng + 0.0044, label: 'Next client' }, lca); // 400 m from D
    await runOnce();
    const o = await getDriverActiveOffer(a);
    expect(o).not.toBeNull();
    expect(o!.afterTrip).toBe(true);
    expect(await getDriverActiveOffer(m)).toBeNull();
    expect((await acceptOffer(o!.offerId, a)).ok).toBe(true);
    // Queued: the booking is his (ASSIGNED), his current trip is still the active one.
    expect((await prisma.booking.findUnique({ where: { id: b2.id } }))!.status).toBe('ASSIGNED');
    const q = (await prisma.assignment.findFirst({ where: { activeBookingId: b2.id } }))!;
    expect([q.queuedDriverId, q.activeDriverId]).toEqual([a, null]);
    expect((await driverCurrentTrip(a)).trip?.bookingId).toBe(b1.id);
    expect((await driverCurrentTrip(a)).next?.bookingId).toBe(b2.id);
    const tv = (await trackingView(b2.id))!;
    expect(tv.finishingNearby).toBe(true);
    // He finishes the current trip → the next ride becomes his trip, the passenger hears he is on the way.
    expect((await completeTrip(b1.id, a, b1.revision)).ok).toBe(true);
    expect((await prisma.booking.findUnique({ where: { id: b2.id } }))!.status).toBe('EN_ROUTE');
    const q2 = (await prisma.assignment.findFirst({ where: { activeBookingId: b2.id } }))!;
    expect([q2.queuedDriverId, q2.activeDriverId]).toEqual([null, a]);
    expect((await driverCurrentTrip(a)).trip?.bookingId).toBe(b2.id);
    expect(await prisma.notificationOutbox.count({ where: { audience: `PASSENGER:${b2.id}`, msg: { path: ['k'], equals: 'ride.nextOnWay' } } })).toBe(1);
  });

  it('6 min left: not for a client 1.5 km from the drop-off (5 min rule), yes for one 400 m away (7 min rule)', async () => {
    const { a } = await andreasOnTrip(4); // ~6 min left at 40 km/h
    const far = await book({ lat: D.lat, lng: D.lng + 0.0165, label: 'Far client' }, lca); // ~1.5 km
    await runOnce();
    expect(await getDriverActiveOffer(a)).toBeNull();
    await prisma.booking.update({ where: { id: far.id }, data: { status: 'CANCELED' } });
    await prisma.dispatchJob.deleteMany({});
    await book({ lat: D.lat, lng: D.lng + 0.0044, label: 'Near client' }, lca); // ~400 m
    await runOnce();
    expect((await getDriverActiveOffer(a))?.afterTrip).toBe(true);
  });

  it('only one next ride; not before the passenger is on board', async () => {
    const { a } = await andreasOnTrip(1);
    const b2 = await book({ lat: D.lat, lng: D.lng + 0.0044, label: 'One' }, lca);
    await runOnce();
    expect((await acceptOffer((await getDriverActiveOffer(a))!.offerId, a)).ok).toBe(true);
    await book({ lat: D.lat + 0.002, lng: D.lng + 0.0044, label: 'Two' }, lca);
    await runOnce();
    expect(await getDriverActiveOffer(a)).toBeNull();
    void b2;
    // Still driving to his passenger (EN_ROUTE): no next order.
    await cleanup();
    const p = await at('Andreas', marina.lat + 0.001, marina.lng);
    await book(marina, D);
    await runOnce();
    expect((await acceptOffer((await getDriverActiveOffer(p))!.offerId, p)).ok).toBe(true);
    await at('Andreas', D.lat - 0.005, D.lng);
    await book({ lat: D.lat, lng: D.lng + 0.0044, label: 'Three' }, lca);
    await runOnce();
    expect(await getDriverActiveOffer(p)).toBeNull();
  });
});
