import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { airportAt, pinAirportAreas } from '@/lib/airports';
import { ensureAirportAreas, invalidateNoGoCache, noGoData, noGoSchema } from '@/server/no-go';
import { findFixedFare, invalidateFixedFareCache } from '@/server/fixed-fares';
import { createQuote } from '@/server/quote';

// Operator 2026-11-25: «Уберай круг» — the airport is a pickup territory marked «это аэропорт», set by hand.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

const PFO = { lat: 34.718, lng: 32.4857 };
const nearPfo = { lat: 34.732, lng: 32.4857 }; // ~1.6 km north: inside the old 2.5 km circle, outside the territory below
const town = { lat: 34.7629, lng: 32.4182 }; // Kato Paphos
// A small territory around the Paphos terminal (about 600 × 600 m).
const terr: [number, number][] = [[34.715, 32.482], [34.715, 32.489], [34.721, 32.489], [34.721, 32.482]];
const box: [number, number][] = [[34.74, 32.40], [34.74, 32.46], [34.79, 32.46], [34.79, 32.40]];

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`);
  pinAirportAreas(null); // the real thing: areas from the DB
});
afterAll(async () => {
  await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'AP test' } } });
  invalidateNoGoCache();
});
beforeEach(async () => {
  await prisma.noGoZone.deleteMany({ where: { name: { startsWith: 'AP test' } } });
  await prisma.noGoZone.updateMany({ where: { airport: { not: null } }, data: { airport: null } }); // only this file's territory counts
  await prisma.fixedFareZone.deleteMany({});
  await prisma.fixedFareZone.create({ data: { airport: 'PFO', name: 'Paphos', polygon: box, comfortCents: 3500, xlCents: 5000 } });
  invalidateNoGoCache(); invalidateFixedFareCache();
});

const territory = (airport: string | null) => prisma.noGoZone.create({ data: {
  name: 'AP test Paphos', kind: 'POINT', polygon: terr, airport,
  points: [{ lat: 34.718, lng: 32.4857, name: 'Arrivals' }],
} });

describe('airport = a pickup territory marked «это аэропорт»', () => {
  it('no territory marked → no airport at all (no circle), so no fixed fare', async () => {
    await territory(null);
    await ensureAirportAreas();
    expect(airportAt(PFO.lat, PFO.lng)).toBeNull();
    expect(await findFixedFare(PFO, town, 'COMFORT')).toBeNull();
    const q = await createQuote({ pickup: PFO, dropoff: town, vClass: 'COMFORT', passengerCount: 1 });
    expect(q.ok && q.quote.airport).toBe(false);
  });

  it('marked → inside it is the airport (fixed fare); 1.6 km away, outside it, is not', async () => {
    await territory('PFO');
    await ensureAirportAreas();
    expect(airportAt(PFO.lat, PFO.lng)).toBe('PFO');
    expect(airportAt(nearPfo.lat, nearPfo.lng)).toBeNull();
    expect((await findFixedFare(PFO, town, 'COMFORT'))?.cents).toBe(3500);
    expect(await findFixedFare(nearPfo, town, 'COMFORT')).toBeNull();
    const q = await createQuote({ pickup: town, dropoff: PFO, vClass: 'COMFORT', passengerCount: 1 });
    expect(q.ok && q.quote.priceType).toBe('REGULATED_FIXED');
    expect(q.ok && q.quote.airport).toBe(true);
  });

  it('a switched-off territory is not the airport; the on/off switch (no «airport» sent) keeps the mark', async () => {
    const t = await territory('PFO');
    const body = noGoSchema.parse({ name: t.name, kind: 'POINT', polygon: terr, points: [{ lat: 34.718, lng: 32.4857, name: 'Arrivals' }], active: false });
    await prisma.noGoZone.update({ where: { id: t.id }, data: noGoData(body) });
    invalidateNoGoCache(); await ensureAirportAreas();
    expect(airportAt(PFO.lat, PFO.lng)).toBeNull();
    expect((await prisma.noGoZone.findUnique({ where: { id: t.id } }))?.airport).toBe('PFO');
    // A no-go zone's form never changes its fixed-prices link (only the fixed-prices page sets it, 2026-11-26).
    expect('airport' in noGoData(noGoSchema.parse({ name: 'x', kind: 'NOGO', polygon: terr, airport: 'PFO' }))).toBe(false);
    expect(noGoSchema.safeParse({ name: 'x', kind: 'POINT', polygon: terr, points: [{ lat: 34.718, lng: 32.4857 }], airport: 'XXX' }).success).toBe(false);
  });
});
