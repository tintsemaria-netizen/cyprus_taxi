import { describe, it, expect } from 'vitest';
import { prebookMinCents, bookingMinCents } from '@/lib/prebook-min';
import { fareRangeCents } from '@/lib/price-type';

// Pre-booking minimum in Nicosia (operator, 2026-11-22): at least €20, above that the meter.
const nicA = { lat: 35.1667, lng: 33.3667 }; // Eleftheria Sq.
const nicB = { lat: 35.145, lng: 33.34 }; // Strovolos
const lca = { lat: 34.8751, lng: 33.6249 };
const larnaca = { lat: 34.9182, lng: 33.6232 };

describe('pre-booking minimum in Nicosia', () => {
  it('pre-booking inside Nicosia → €20 minimum', () => {
    expect(prebookMinCents({ pickup: nicA, dropoff: nicB, scheduled: true, priceType: 'REGULATED_METER_ESTIMATE' })).toBe(2000);
  });
  it('not for a ride now, outside Nicosia, from/to Nicosia, or a fixed fare', () => {
    expect(prebookMinCents({ pickup: nicA, dropoff: nicB, scheduled: false })).toBeNull();
    expect(prebookMinCents({ pickup: larnaca, dropoff: larnaca, scheduled: true })).toBeNull();
    expect(prebookMinCents({ pickup: nicA, dropoff: lca, scheduled: true })).toBeNull();
    expect(prebookMinCents({ pickup: nicA, dropoff: nicB, scheduled: true, priceType: 'REGULATED_FIXED' })).toBeNull();
    expect(prebookMinCents({ pickup: nicA, dropoff: nicB, scheduled: true, priceType: 'SHARED_FIXED' })).toBeNull();
  });
  it('booking rows use the same rule', () => {
    expect(bookingMinCents({ pickupLat: nicA.lat, pickupLng: nicA.lng, dropoffLat: nicB.lat, dropoffLng: nicB.lng, scheduledAt: new Date(), priceType: null })).toBe(2000);
  });
  it('the ±15 % range never goes below the minimum; above it the estimate counts', () => {
    expect(fareRangeCents(2000, 'REGULATED_METER_ESTIMATE', 2000)).toEqual([2000, 2300]);
    expect(fareRangeCents(3000, 'REGULATED_METER_ESTIMATE', 2000)).toEqual([2550, 3450]);
    expect(fareRangeCents(2000, 'REGULATED_METER_ESTIMATE')).toEqual([1700, 2300]);
  });
});
