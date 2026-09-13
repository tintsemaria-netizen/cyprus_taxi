import { describe, it, expect } from 'vitest';
import { computeMeterEstimate, isNightTariff } from '@/lib/tariff';

describe('Cyprus urban meter estimate', () => {
  it('day tariff: initial + per-km', () => {
    // 10 km at day tariff: 380 + round(10*95) = 380 + 950 = 1330 cents
    const at = new Date('2026-06-15T09:00:00Z'); // 12:00 Nicosia (summer UTC+3), day
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at });
    expect(isNightTariff(at)).toBe(false);
    expect(e.totalCents).toBe(1330);
  });
  it('night tariff higher initial + per-km', () => {
    const at = new Date('2026-06-15T20:00:00Z'); // 23:00 Nicosia, night
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at });
    expect(isNightTariff(at)).toBe(true);
    expect(e.totalCents).toBe(480 + 1100); // 1580
  });
  it('5-passenger surcharge +20%', () => {
    const at = new Date('2026-06-15T09:00:00Z');
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 5, at });
    // base 1330 + 20% = 1330 + 266 = 1596
    expect(e.totalCents).toBe(1596);
  });
});
