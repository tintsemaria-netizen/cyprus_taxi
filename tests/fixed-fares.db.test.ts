import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Fixed airport fares drawn in admin (2026-11-17).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
import { createQuote } from '@/server/quote';
import { prisma } from '@/lib/db';
import { findFixedFare, invalidateFixedFareCache, zoneData, zoneSchema } from '@/server/fixed-fares';
import { nextBelt, polygonInside } from '@/lib/zone-shapes';
import { isFixedPrice } from '@/lib/price-type';

const PFO = { lat: 34.718, lng: 32.4857 };
const LCA = { lat: 34.8751, lng: 33.6249 };
// A box around Paphos centre / Kato Paphos.
const box: [number, number][] = [[34.74, 32.40], [34.74, 32.46], [34.79, 32.46], [34.79, 32.40]];
const inside = { lat: 34.7629, lng: 32.4182 };
const outside = { lat: 34.857, lng: 32.367 }; // Coral Bay

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run DB tests on "${dbName}".`);
});
beforeEach(async () => {
  await prisma.fixedFareZone.deleteMany({});
  await prisma.fixedFareZone.create({ data: { airport: 'PFO', name: 'Paphos', polygon: box, comfortCents: 3500, xlCents: 5000 } });
  invalidateFixedFareCache();
});

describe('fixed airport fares', () => {
  it('airport → zone and zone → airport get exactly the zone price (Comfort / XL)', async () => {
    const a = await createQuote({ pickup: PFO, dropoff: inside, vClass: 'COMFORT', passengerCount: 1 });
    expect(a.ok && a.quote.priceType).toBe('REGULATED_FIXED');
    expect(a.ok && [a.quote.totalCents, a.quote.rangeLowCents, a.quote.rangeHighCents]).toEqual([3500, 3500, 3500]);
    const b = await createQuote({ pickup: inside, dropoff: PFO, vClass: 'XL', passengerCount: 5 });
    expect(b.ok && b.quote.priceType).toBe('REGULATED_FIXED');
    expect(b.ok && b.quote.totalCents).toBe(5000);
  });

  it('outside the zone, with a stop, another airport or an inactive zone → meter estimate', async () => {
    const out = await createQuote({ pickup: PFO, dropoff: outside, vClass: 'COMFORT', passengerCount: 1 });
    expect(out.ok && out.quote.priceType).toBe('REGULATED_METER_ESTIMATE');
    const stop = await createQuote({ pickup: PFO, dropoff: inside, stop: { lat: 34.75, lng: 32.45 }, vClass: 'COMFORT', passengerCount: 1 });
    expect(stop.ok && stop.quote.priceType).toBe('REGULATED_METER_ESTIMATE');
    expect(await findFixedFare(LCA, inside, 'COMFORT')).toBeNull();
    expect(await findFixedFare(inside, { lat: 34.77, lng: 32.43 }, 'COMFORT')).toBeNull(); // no airport end
    await prisma.fixedFareZone.updateMany({ data: { active: false } });
    invalidateFixedFareCache();
    expect(await findFixedFare(PFO, inside, 'COMFORT')).toBeNull();
  });

  it('overlapping zones → the SMALLEST one wins, even when it is dearer (2026-11-21)', async () => {
    await prisma.fixedFareZone.create({ data: { airport: 'PFO', name: 'Inner', polygon: [[34.76, 32.41], [34.76, 32.43], [34.77, 32.43], [34.77, 32.41]], comfortCents: 4200, xlCents: 6000 } });
    invalidateFixedFareCache();
    expect((await findFixedFare(PFO, inside, 'COMFORT'))?.cents).toBe(4200);
    expect((await findFixedFare(PFO, { lat: 34.78, lng: 32.45 }, 'COMFORT'))?.cents).toBe(3500);
  });

  it('price belts: the next zone starts where the previous ends; inside stays the previous price', async () => {
    await prisma.fixedFareZone.deleteMany({});
    const inner: [number, number][] = [[34.70, 32.46], [34.70, 32.51], [34.74, 32.51], [34.74, 32.46]];
    const belt = nextBelt(inner, 4000);
    expect(belt.length).toBeGreaterThanOrEqual(24);
    expect(polygonInside(inner, belt)).toBe(true);
    await prisma.fixedFareZone.create({ data: zoneData({ airport: 'PFO', name: 'Centre', polygon: inner, comfortCents: 2500, xlCents: 3500 }) });
    await prisma.fixedFareZone.create({ data: zoneData({ airport: 'PFO', name: 'Belt 2', polygon: belt, comfortCents: 3500, xlCents: 5000 }) });
    invalidateFixedFareCache();
    expect((await findFixedFare(PFO, { lat: 34.72, lng: 32.48 }, 'COMFORT'))?.cents).toBe(2500); // inside the centre
    expect((await findFixedFare(PFO, { lat: 34.755, lng: 32.48 }, 'COMFORT'))?.cents).toBe(3500); // in the belt
    expect(await findFixedFare(PFO, { lat: 34.82, lng: 32.48 }, 'COMFORT')).toBeNull(); // beyond → meter
    expect(zoneSchema.safeParse({ airport: 'PFO', name: 'x', polygon: [[1, 1], [2, 2]], comfortCents: 2000, xlCents: 3000 }).success).toBe(false);
  });

  it('REGULATED_FIXED counts as a final price', () => {
    expect(isFixedPrice('REGULATED_FIXED')).toBe(true);
    expect(isFixedPrice('REGULATED_METER_ESTIMATE')).toBe(false);
  });
});
