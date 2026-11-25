import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// «Стоянка с очередью» (2026-11-25, operator): orders from the airport go to the stand's queue first, in the order
// the drivers drove in; a refusal keeps the place; nobody there → the usual nearest driver; leaving the stand loses
// the place after 10 s; a switched-off stand gets no orders at all. (Test airports: 2.5 km rings, tests/setup.)
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, rejectOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import { invalidateNoGoCache } from '@/server/no-go';
import { updateStandQueue, standStateFor } from '@/server/stands';
import { listFreeOrders } from '@/server/dispatch/free-orders';
import type { CreateBookingInput } from '@/lib/validation';

const pfo = { lat: 34.718, lng: 32.4857, label: 'Paphos Airport (PFO)' };
const town = { lat: 34.7536, lng: 32.4076, label: 'Paphos harbour' };
// The stand: a square ~300 m east of the terminal (inside the test airport ring).
const S = { lat: 34.718, lng: 32.489 };
const standPoly: [number, number][] = [[S.lat - 0.001, S.lng - 0.001], [S.lat - 0.001, S.lng + 0.001], [S.lat + 0.001, S.lng + 0.001], [S.lat + 0.001, S.lng - 0.001]];
const inStandP = { lat: S.lat, lng: S.lng };
const RUN = `${Date.now()}`;
let n = 0;
const key = () => `stand-${RUN}-${++n}`;

async function at(name: string, p: { lat: number; lng: number }, when = new Date()) {
  const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: p.lat, lng: p.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n }, create: { driverId: d.id, lat: p.lat, lng: p.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n } });
  await updateStandQueue(d.id, p, when);
  return d.id;
}
async function book(p: typeof pfo, d: typeof pfo) {
  const r = await createBooking({ pickup: p, dropoff: d, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'St', phone: '+35799123456' } as CreateBookingInput, key());
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}
async function stand(active: boolean) {
  await prisma.noGoZone.deleteMany({ where: { kind: 'STAND' } });
  await prisma.noGoZone.create({ data: { name: 'PFO stand', kind: 'STAND', polygon: standPoly, airport: 'PFO', active } });
  invalidateNoGoCache();
}

beforeAll(async () => { if (!dbName.endsWith('_test')) throw new Error('Refusing: DB name must end in _test'); });
async function cleanup() {
  for (const t of ['chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'latestDriverLocation', 'idempotencyReceipt', 'passengerRating', 'driverSettlement', 'standQueue'] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
  await prisma.booking.deleteMany({});
  await prisma.driver.updateMany({ where: { publicName: { in: ['Andreas', 'Maria', 'Petros'] } }, data: { onDuty: false, available: false } });
}
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await prisma.noGoZone.deleteMany({ where: { kind: 'STAND' } }); invalidateNoGoCache(); });

describe('taxi stand queue', () => {
  it('the first in the queue gets the airport order before a nearer driver; a refusal keeps his place', async () => {
    await stand(true);
    const t0 = Date.now() - 60_000;
    const m = await at('Maria', inStandP, new Date(t0));
    const a2 = await at('Andreas', { lat: S.lat + 0.0005, lng: S.lng }, new Date(t0 + 1000)); // in the stand, second
    expect((await standStateFor(m, inStandP))?.place).toBe(1);
    expect((await standStateFor(a2, inStandP))?.place).toBe(2);

    const b = await book(pfo, town);
    await runOnce();
    const o = await getDriverActiveOffer(m);
    expect(o).not.toBeNull();
    expect(await getDriverActiveOffer(a2)).toBeNull();
    expect((await rejectOffer(o!.offerId, m)).ok).toBe(true);
    await runOnce();
    const o2 = await getDriverActiveOffer(a2);
    expect(o2).not.toBeNull();
    // Maria refused: still first.
    expect((await standStateFor(m, inStandP))?.place).toBe(1);
    expect((await acceptOffer(o2!.offerId, a2)).ok).toBe(true);
    // A ride ends his place in the queue.
    expect(await prisma.standQueue.findUnique({ where: { driverId: a2 } })).toBeNull();
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).not.toBe('SEARCHING');
  });

  it('the queue beats the nearest driver outside', async () => {
    await stand(true);
    const a = await at('Andreas', { lat: pfo.lat, lng: pfo.lng + 0.0005 }); // right at the terminal, outside the stand
    const m = await at('Maria', inStandP);
    await book(pfo, town);
    await runOnce();
    expect(await getDriverActiveOffer(m)).not.toBeNull();
    expect(await getDriverActiveOffer(a)).toBeNull();
  });

  it('nobody in the stand → the nearest driver outside', async () => {
    await stand(true);
    const a = await at('Andreas', { lat: pfo.lat, lng: pfo.lng + 0.0005 });
    await book(pfo, town);
    await runOnce();
    expect(await getDriverActiveOffer(a)).not.toBeNull();
  });

  it('leaving the stand: the place is kept 10 s, then lost', async () => {
    await stand(true);
    const t0 = Date.now() - 60_000;
    const m = await at('Maria', inStandP, new Date(t0));
    const out = { lat: S.lat + 0.01, lng: S.lng };
    await updateStandQueue(m, out, new Date(t0 + 5_000));
    expect(await prisma.standQueue.findUnique({ where: { driverId: m } })).not.toBeNull();
    await updateStandQueue(m, out, new Date(t0 + 11_000));
    expect(await prisma.standQueue.findUnique({ where: { driverId: m } })).toBeNull();
    // Back in: the end of the queue, a new time.
    await updateStandQueue(m, inStandP, new Date(t0 + 20_000));
    expect((await prisma.standQueue.findUnique({ where: { driverId: m } }))!.enteredAt.getTime()).toBe(t0 + 20_000);
  });

  it('a switched-off stand: no queue, and drivers standing there get no orders (the board included)', async () => {
    await stand(false);
    const m = await at('Maria', inStandP);
    expect(await prisma.standQueue.findUnique({ where: { driverId: m } })).toBeNull();
    expect((await standStateFor(m, inStandP))?.on).toBe(false);
    const a = await at('Andreas', town); // ~8 km away
    await book(pfo, town);
    await runOnce();
    expect(await getDriverActiveOffer(m)).toBeNull();
    expect(await getDriverActiveOffer(a)).not.toBeNull();
    expect(await listFreeOrders(m)).toEqual([]);
  });

  it('a driver bringing a passenger does not join the queue', async () => {
    await stand(true);
    const a = await at('Andreas', town);
    await book(town, pfo);
    await runOnce();
    const o = await getDriverActiveOffer(a);
    expect((await acceptOffer(o!.offerId, a)).ok).toBe(true);
    await at('Andreas', inStandP);
    expect(await prisma.standQueue.findUnique({ where: { driverId: a } })).toBeNull();
  });
});
