import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { invalidateNoGoCache, noGoData, noGoSchema, snapPickup, snapDropoff } from '@/server/no-go';
import { GET as publicNoGo } from '@/app/api/v1/no-go/route';
import { invalidateFixedFareCache } from '@/server/fixed-fares';
import { invalidateMinFareCache } from '@/server/min-fares';
import { createQuote } from '@/server/quote';

// «Минимальный заказ отсюда» (operator 2026-11-25): from a pickup point the ride costs at least €20, above it the meter.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

// A «port» territory in Limassol (no airport) and an exit point inside it.
const port: [number, number][] = [[34.640, 33.010], [34.640, 33.020], [34.648, 33.020], [34.648, 33.010]];
const gate = { lat: 34.644, lng: 33.015 };
const near = { lat: 34.652, lng: 33.030 }; // ~1.7 km away — the meter is well under €20
const far = { lat: 34.9167, lng: 33.629 }; // Larnaca — the meter is well over €20
const outside = { lat: 34.660, lng: 33.040 };

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`); });
afterAll(async () => { await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'PM test' } } }); invalidateNoGoCache(); });
beforeEach(async () => {
  await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'PM test' } } });
  await prisma.minFareZone.deleteMany({});
  invalidateNoGoCache(); invalidateFixedFareCache(); invalidateMinFareCache();
});

const make = (minComfortCents: number | null, minXlCents: number | null) => prisma.noGoZone.create({ data: {
  name: 'PM test port', kind: 'POINT', polygon: port, points: [{ ...gate, name: 'Gate' }], minComfortCents, minXlCents,
} });
const quote = async (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }, vClass: 'COMFORT' | 'XL' = 'COMFORT', scheduled = false) => {
  const q = await createQuote({ pickup, dropoff, vClass, passengerCount: 1, scheduledAtUtc: scheduled ? new Date(Date.now() + 5 * 3600_000).toISOString() : null });
  if (!q.ok) throw new Error('quote failed');
  return q.quote;
};

describe('minimum fare from a pickup point', () => {
  it('a short ride from the point is raised to the minimum (now and pre-booked), Comfort and XL separately', async () => {
    await make(2000, 3000);
    const now = await quote(gate, near);
    expect(now.totalCents).toBe(2000);
    expect(now.minCents).toBe(2000);
    expect(now.minZone).toBe('PM test port');
    expect((await quote(gate, near, 'COMFORT', true)).totalCents).toBe(2000);
    expect((await quote(gate, near, 'XL')).totalCents).toBe(3000);
  });

  it('a long ride stays on the meter; a ride from outside or TO the point has no minimum', async () => {
    await make(2000, 3000);
    const long = await quote(gate, far);
    expect(long.totalCents).toBeGreaterThan(2000);
    expect(long.minCents).toBe(2000); // still the floor if the meter ends lower
    expect((await quote(outside, near)).minCents ?? null).toBeNull();
    expect((await quote(near, gate)).minCents ?? null).toBeNull();
  });

  it('no minimum set → nothing; with the «Минимум предзаказа» zone too → the larger one', async () => {
    await make(null, null);
    expect((await quote(gate, near)).minCents ?? null).toBeNull();
    await prisma.noGoZone.updateMany({ where: { name: 'PM test port' }, data: { minComfortCents: 1500 } });
    await prisma.minFareZone.create({ data: { name: 'Limassol', polygon: [[34.60, 32.95], [34.60, 33.10], [34.72, 33.10], [34.72, 32.95]], comfortCents: 1800, xlCents: 2500 } });
    invalidateNoGoCache(); invalidateMinFareCache();
    const q = await quote(gate, near, 'COMFORT', true);
    expect(q.totalCents).toBe(1800);
    expect(q.minZone).toBe('Limassol');
  });

  it('the minimum switch: off → the normal price, the amounts are kept; on again → the minimum is back', async () => {
    const t = await make(2000, 3000);
    const base = { name: t.name, kind: 'POINT' as const, polygon: port, points: [{ ...gate, name: 'Gate' }] };
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(noGoSchema.parse({ ...base, minActive: false })) });
    invalidateNoGoCache();
    expect((await quote(gate, near)).minCents ?? null).toBeNull();
    const row = await prisma.noGoZone.findUnique({ where: { id: t.id } });
    expect([row?.minComfortCents, row?.minXlCents, row?.minActive]).toEqual([2000, 3000, false]);
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(noGoSchema.parse({ ...base, minActive: true })) });
    invalidateNoGoCache();
    expect((await quote(gate, near)).totalCents).toBe(2000);
  });

  it('a territory without pickup points (2026-11-25): saves, does not move the pickup, its minimum still applies', async () => {
    expect(noGoSchema.safeParse({ name: 'PM test bare', kind: 'POINT', polygon: port, points: [] }).success).toBe(true);
    await prisma.noGoZone.create({ data: { name: 'PM test bare', kind: 'POINT', polygon: port, points: [], minComfortCents: 2000 } });
    invalidateNoGoCache();
    const inside = { lat: 34.6435, lng: 33.0135 };
    expect(await snapPickup(inside)).toEqual(inside);
    expect((await quote(inside, near)).totalCents).toBe(2000);
  });

  it('«Точки подачи и высадки» switched off: nobody is moved, the points are kept, the minimum still applies', async () => {
    const t = await prisma.noGoZone.create({ data: { name: 'PM test pts', kind: 'POINT', polygon: port, points: [{ ...gate, name: 'Gate' }], dropPoints: [{ lat: 34.6425, lng: 33.012, name: 'Drop' }], minComfortCents: 2000 } });
    invalidateNoGoCache();
    const inside = { lat: 34.6435, lng: 33.0135 };
    expect((await snapPickup(inside)).lat).toBe(gate.lat);
    const base = { name: t.name, kind: 'POINT' as const, polygon: port, points: [{ ...gate, name: 'Gate' }], dropPoints: [{ lat: 34.6425, lng: 33.012, name: 'Drop' }] };
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(noGoSchema.parse({ ...base, pointsActive: false })) });
    invalidateNoGoCache();
    expect(await snapPickup(inside)).toEqual(inside);
    expect(await snapDropoff(inside)).toEqual(inside);
    const pub = await (await publicNoGo()).json();
    const mine = (pub.territories ?? pub.data?.territories).find((x: { name: string }) => x.name === 'PM test pts');
    expect([mine.points.length, mine.dropPoints.length]).toEqual([0, 0]);
    expect((await prisma.noGoZone.findUnique({ where: { id: t.id } }))?.points).toHaveLength(1);
    expect((await quote(inside, near)).totalCents).toBe(2000);
  });

  it('admin form: empty clears, the on/off switch keeps it', async () => {
    const t = await make(2000, 3000);
    const base = { name: t.name, kind: 'POINT' as const, polygon: port, points: [{ ...gate, name: 'Gate' }] };
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(noGoSchema.parse({ ...base, active: false })) });
    expect((await prisma.noGoZone.findUnique({ where: { id: t.id } }))?.minComfortCents).toBe(2000);
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(noGoSchema.parse({ ...base, minComfortCents: null, minXlCents: null })) });
    expect((await prisma.noGoZone.findUnique({ where: { id: t.id } }))?.minComfortCents).toBeNull();
  });
});
