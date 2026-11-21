import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Fixed airport fares drawn in admin (2026-11-17).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
import { createQuote } from '@/server/quote';
import { prisma } from '@/lib/db';
import { findFixedFare, invalidateFixedFareCache, zoneData, zoneSchema } from '@/server/fixed-fares';
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

  it('price rings around the airport: up to 5 km, 5–15 km, beyond → meter; a drawn district beats a ring', async () => {
    await prisma.fixedFareZone.deleteMany({});
    const ap = { lat: 34.718, lng: 32.4857 };
    await prisma.fixedFareZone.create({ data: zoneData({ airport: 'PFO', name: '5 km', radiusM: 5000, comfortCents: 2000, xlCents: 3000 }) });
    await prisma.fixedFareZone.create({ data: zoneData({ airport: 'PFO', name: '15 km', radiusM: 15000, comfortCents: 3500, xlCents: 5000 }) });
    invalidateFixedFareCache();
    const at = (km: number) => ({ lat: ap.lat + km / 111.32, lng: ap.lng }); // due north
    expect((await findFixedFare(PFO, at(4), 'COMFORT'))?.cents).toBe(2000);
    expect((await findFixedFare(PFO, at(10), 'XL'))?.cents).toBe(5000);
    expect(await findFixedFare(PFO, at(20), 'COMFORT')).toBeNull();
    expect((await findFixedFare(at(10), PFO, 'COMFORT'))?.cents).toBe(3500); // zone → airport too
    const p = at(10);
    await prisma.fixedFareZone.create({ data: { airport: 'PFO', name: 'Hills', polygon: [[p.lat - 0.01, p.lng - 0.01], [p.lat - 0.01, p.lng + 0.01], [p.lat + 0.01, p.lng + 0.01], [p.lat + 0.01, p.lng - 0.01]], comfortCents: 4000, xlCents: 5500 } });
    invalidateFixedFareCache();
    expect((await findFixedFare(PFO, p, 'COMFORT'))?.cents).toBe(4000);
    expect(zoneSchema.safeParse({ airport: 'PFO', name: 'x', radiusM: 100, comfortCents: 2000, xlCents: 3000 }).success).toBe(false);
    expect(zoneSchema.safeParse({ airport: 'PFO', name: 'x', comfortCents: 2000, xlCents: 3000 }).success).toBe(false);
  });

  it('REGULATED_FIXED counts as a final price', () => {
    expect(isFixedPrice('REGULATED_FIXED')).toBe(true);
    expect(isFixedPrice('REGULATED_METER_ESTIMATE')).toBe(false);
  });
});
