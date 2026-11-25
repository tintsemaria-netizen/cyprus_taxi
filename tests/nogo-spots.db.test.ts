import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { firstNoGo, invalidateNoGoCache, noGoSchema, snapPickup, snapDropoff } from '@/server/no-go';
import { GET as publicNoGo } from '@/app/api/v1/no-go/route';

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
});
