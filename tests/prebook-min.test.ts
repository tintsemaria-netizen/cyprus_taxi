import { describe, it, expect } from 'vitest';
import { minFor, bookingMin, type MinZone } from '@/lib/prebook-min';
import { fareRangeCents } from '@/lib/price-type';

// Pre-booking minimum by area (operator, 2026-11-22): at least the area's price (Comfort / XL), above it the meter.
// The starting Nicosia-district outline, as in migration 20261122020000_min_fare_zones.
const NICOSIA: MinZone = { id: 'n', name: 'Район Никосии', comfortCents: 2000, xlCents: 2800,
  polygon: [[35.18,32.68],[35.14,32.84],[35.15,33.03],[35.18,33.16],[35.19,33.30],[35.18,33.40],[35.15,33.46],[35.10,33.50],[35.04,33.47],[34.99,33.42],[34.95,33.30],[34.91,33.18],[34.91,33.05],[34.94,32.95],[34.95,32.83],[34.97,32.72],[35.05,32.65],[35.14,32.62]] };
const SMALL: MinZone = { id: 's', name: 'Centre', comfortCents: 1500, xlCents: 2000, polygon: [[35.16,33.35],[35.18,33.35],[35.18,33.38],[35.16,33.38]] };
const centre = { lat: 35.1667, lng: 33.3667 };
const strovolos = { lat: 35.145, lng: 33.34 };
const dali = { lat: 35.02, lng: 33.42 }; // district village
const kakopetria = { lat: 34.99, lng: 32.90 }; // Troodos, Nicosia district
const lca = { lat: 34.8751, lng: 33.6249 };
const larnaca = { lat: 34.9182, lng: 33.6232 };
const limassol = { lat: 34.69, lng: 33.04 };

describe('pre-booking minimum by area', () => {
  it('whole Nicosia district: town, villages and Troodos side', () => {
    for (const [a, b] of [[centre, strovolos], [centre, dali], [strovolos, kakopetria]]) {
      expect(minFor([NICOSIA], { pickup: a, dropoff: b, scheduled: true })).toEqual({ cents: 2000, zone: 'Район Никосии' });
    }
  });
  it('XL has its own price', () => {
    expect(minFor([NICOSIA], { pickup: centre, dropoff: dali, scheduled: true, vClass: 'XL' })?.cents).toBe(2800);
  });
  it('not for a ride now, another district, leaving the district, or a fixed / shared fare', () => {
    expect(minFor([NICOSIA], { pickup: centre, dropoff: strovolos, scheduled: false })).toBeNull();
    expect(minFor([NICOSIA], { pickup: larnaca, dropoff: larnaca, scheduled: true })).toBeNull();
    expect(minFor([NICOSIA], { pickup: centre, dropoff: lca, scheduled: true })).toBeNull();
    expect(minFor([NICOSIA], { pickup: centre, dropoff: limassol, scheduled: true })).toBeNull();
    expect(minFor([NICOSIA], { pickup: centre, dropoff: strovolos, scheduled: true, priceType: 'REGULATED_FIXED' })).toBeNull();
    expect(minFor([NICOSIA], { pickup: centre, dropoff: strovolos, scheduled: true, priceType: 'SHARED_FIXED' })).toBeNull();
  });
  it('several areas → the smallest one around both points wins', () => {
    expect(minFor([NICOSIA, SMALL], { pickup: centre, dropoff: { lat: 35.17, lng: 33.36 }, scheduled: true })?.zone).toBe('Centre');
    expect(minFor([NICOSIA, SMALL], { pickup: centre, dropoff: strovolos, scheduled: true })?.zone).toBe('Район Никосии');
  });
  it('booking rows use the same rule', () => {
    expect(bookingMin([NICOSIA], { pickupLat: centre.lat, pickupLng: centre.lng, dropoffLat: dali.lat, dropoffLng: dali.lng, scheduledAt: new Date(), priceType: null, vClass: 'COMFORT' })?.cents).toBe(2000);
  });
  it('the ±15 % range never goes below the minimum; above it the estimate counts', () => {
    expect(fareRangeCents(2000, 'REGULATED_METER_ESTIMATE', 2000)).toEqual([2000, 2300]);
    expect(fareRangeCents(3000, 'REGULATED_METER_ESTIMATE', 2000)).toEqual([2550, 3450]);
    expect(fareRangeCents(2000, 'REGULATED_METER_ESTIMATE')).toEqual([1700, 2300]);
  });
});
