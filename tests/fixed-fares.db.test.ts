import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Fixed airport fares drawn in admin (2026-11-17).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
import { createQuote } from '@/server/quote';
import { prisma } from '@/lib/db';
import { findFixedFare, invalidateFixedFareCache } from '@/server/fixed-fares';
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

  it('overlapping zones → the cheapest wins', async () => {
    await prisma.fixedFareZone.create({ data: { airport: 'PFO', name: 'Inner', polygon: [[34.76, 32.41], [34.76, 32.43], [34.77, 32.43], [34.77, 32.41]], comfortCents: 3000, xlCents: 4500 } });
    invalidateFixedFareCache();
    expect((await findFixedFare(PFO, inside, 'COMFORT'))?.cents).toBe(3000);
    expect((await findFixedFare(PFO, { lat: 34.78, lng: 32.45 }, 'COMFORT'))?.cents).toBe(3500);
  });

  it('REGULATED_FIXED counts as a final price', () => {
    expect(isFixedPrice('REGULATED_FIXED')).toBe(true);
    expect(isFixedPrice('REGULATED_METER_ESTIMATE')).toBe(false);
  });
});
