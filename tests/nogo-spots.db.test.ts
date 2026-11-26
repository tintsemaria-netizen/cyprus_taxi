import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { firstNoGo, invalidateNoGoCache, noGoSchema, snapPickup, snapDropoff } from '@/server/no-go';
import { GET as publicNoGo } from '@/app/api/v1/no-go/route';
import { airportAt, pinAirportAreas } from '@/lib/airports';
import { ensureAirportAreas, pointMin } from '@/server/no-go';
import { createQuote } from '@/server/quote';
import { invalidateFixedFareCache } from '@/server/fixed-fares';
import { invalidateMinFareCache } from '@/server/min-fares';

// «Запретная зона» with pickup / drop-off points NEXT TO it (operator 2026-11-26: «Нет, рядом с ней»).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

const zone: [number, number][] = [[34.680, 33.030], [34.680, 33.040], [34.688, 33.040], [34.688, 33.030]];
const insideZ = { lat: 34.684, lng: 33.035 };
const pick = { lat: 34.6785, lng: 33.035, name: 'South gate' }; // just south of the zone
const drop = { lat: 34.6895, lng: 33.035, name: 'North gate' }; // just north of it

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`); });
afterAll(async () => { await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'NS test' } } }); invalidateNoGoCache(); });
beforeEach(async () => { await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'NS test' } } }); invalidateNoGoCache(); });

const make = (points: unknown[], dropPoints: unknown[], pointsActive = true) =>
  prisma.noGoZone.create({ data: { name: 'NS test zone', kind: 'NOGO', polygon: zone, points: points as never, dropPoints: dropPoints as never, pointsActive } });

describe('no-go zone with points next to it', () => {
  it('a pickup inside goes to the nearest pickup point, a destination inside to the drop-off point — then nothing is refused', async () => {
    await make([pick], [drop]);
    const p = await snapPickup({ ...insideZ, label: '' as string | undefined });
    const d = await snapDropoff({ ...insideZ });
    expect([p.lat, p.lng]).toEqual([pick.lat, pick.lng]);
    expect([d.lat, d.lng]).toEqual([drop.lat, drop.lng]);
    expect(p.label).toContain('NS test zone');
    expect(await firstNoGo({ pickup: p, dropoff: d })).toBeNull();
  });

  it('no points, or points switched off → refused as before', async () => {
    await make([], []);
    expect(await firstNoGo({ pickup: await snapPickup({ ...insideZ }), dropoff: { lat: 34.70, lng: 33.06 } })).toBe('pickup');
    await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'NS test' } } }); invalidateNoGoCache();
    await make([pick], [drop], false);
    const p = await snapPickup({ ...insideZ });
    expect([p.lat, p.lng]).toEqual([insideZ.lat, insideZ.lng]);
    expect(await firstNoGo({ pickup: p, dropoff: { lat: 34.70, lng: 33.06 } })).toBe('pickup');
  });

  it('the public map gets the zone as points to snap to, not as a block', async () => {
    await make([pick], [drop]);
    const j = await (await publicNoGo()).json();
    const data = j.data ?? j;
    expect(data.zoneSpots.some((z: { name: string; nogo: boolean }) => z.name === 'NS test zone' && z.nogo)).toBe(true);
    expect(JSON.stringify(data.zones)).not.toContain('34.688');
  });

  it('the points must be next to the zone: not inside, not 3 km+ away', () => {
    const base = { name: 'NS test zone', kind: 'NOGO' as const, polygon: zone, active: true };
    expect(noGoSchema.safeParse({ ...base, points: [pick], dropPoints: [drop] }).success).toBe(true);
    expect(noGoSchema.safeParse({ ...base, points: [{ ...insideZ, name: '' }], dropPoints: [] }).success).toBe(false);
    expect(noGoSchema.safeParse({ ...base, points: [{ lat: 34.72, lng: 33.035, name: '' }], dropPoints: [] }).success).toBe(false);
  });

  it('chosen for an airport\'s fixed prices: the zone and its points next to it count as that airport', async () => {
    pinAirportAreas(null);
    try {
      const row = await make([pick], [drop]);
      await prisma.noGoZone.update({ where: { id: row.id }, data: { airport: 'PFO' } });
      invalidateNoGoCache(); await ensureAirportAreas();
      const p = await snapPickup({ ...insideZ, label: '' as string | undefined });
      const d = await snapDropoff({ ...insideZ });
      expect(airportAt(p.lat, p.lng)).toBe('PFO');
      expect(airportAt(d.lat, d.lng)).toBe('PFO');
      expect(airportAt(34.70, 33.06)).toBeNull();
    } finally { await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'NS test' } } }); invalidateNoGoCache(); await ensureAirportAreas(); }
  });

  it('«Минимальный заказ отсюда» of a no-go zone: a pickup moved from inside to its point costs at least that', async () => {
    const row = await make([pick], [drop]);
    await prisma.noGoZone.update({ where: { id: row.id }, data: { minComfortCents: 2000, minXlCents: 3000 } });
    await prisma.minFareZone.deleteMany({});
    invalidateNoGoCache(); invalidateFixedFareCache(); invalidateMinFareCache();
    const from = await snapPickup({ ...insideZ, label: '' as string | undefined });
    expect(await pointMin(from, 'COMFORT')).toEqual({ cents: 2000, zone: 'NS test zone' });
    const q = await createQuote({ pickup: from, dropoff: { lat: 34.692, lng: 33.046 }, vClass: 'COMFORT', passengerCount: 1, scheduledAtUtc: null });
    expect(q.ok && q.quote.totalCents).toBe(2000);
    expect((await pointMin({ lat: 34.692, lng: 33.046 }, 'COMFORT'))).toBeNull();
    await prisma.noGoZone.update({ where: { id: row.id }, data: { minActive: false } }); invalidateNoGoCache();
    expect(await pointMin(from, 'COMFORT')).toBeNull();
  });
});
