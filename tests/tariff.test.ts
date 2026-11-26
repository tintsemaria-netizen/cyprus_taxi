import { describe, it, expect } from 'vitest';
import { computeMeterEstimate, isNightTariff } from '@/lib/tariff';

describe('Cyprus urban meter estimate', () => {
  it('day tariff: initial + per-km', () => {
    // 10 km at day tariff: 380 + round(10*95) = 380 + 950 = 1330 cents
    const at = new Date('2026-06-15T09:00:00Z'); // 12:00 Nicosia (summer UTC+3), day
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at });
    expect(isNightTariff(at)).toBe(false);
    expect(e.totalCents).toBe(1397); // 3.99 + 10 × 0.9975 (+5 % 2026-11-26)
  });
  it('night tariff higher initial + per-km', () => {
    const at = new Date('2026-06-15T20:00:00Z'); // 23:00 Nicosia, night
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at });
    expect(isNightTariff(at)).toBe(true);
    expect(e.totalCents).toBe(504 + 1155); // 1659
  });
  it('5-passenger surcharge +20%', () => {
    const at = new Date('2026-06-15T09:00:00Z');
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 5, at });
    // base 1330 + 20% = 1330 + 266 = 1596
    expect(e.totalCents).toBe(1676);
  });
});

describe('XL vehicle surcharge (our setting, 2026-11-16)', () => {
  const at = new Date('2026-06-15T20:00:00Z'); // night: 480 + 1100 = 1580 base for 10 km
  it('XL = base +40 %, with its own rule version and line', () => {
    const e = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at, vClass: 'XL' });
    expect(e.totalCents).toBe(1659 + 664); // 2323
    expect(e.lines.find((l) => l.code === 'xl')?.cents).toBe(664);
    expect(e.ruleVersion).toContain('xl40');
    expect(e.rangeLowCents).toBe(Math.round(2323 * 0.88));
    expect(e.rangeHighCents).toBe(Math.round(2323 * 1.12));
  });
  it('XL replaces the 5/6-passenger surcharge — never both', () => {
    const six = computeMeterEstimate({ distanceMeters: 10000, passengerCount: 6, at, vClass: 'XL' });
    expect(six.totalCents).toBe(2323);
    expect(six.lines.some((l) => l.code === 'pax')).toBe(false);
    // …and equals the regulated 6-passenger Comfort meter fare.
    expect(computeMeterEstimate({ distanceMeters: 10000, passengerCount: 6, at }).totalCents).toBe(2323);
  });
  it('Comfort is unchanged', () => {
    expect(computeMeterEstimate({ distanceMeters: 10000, passengerCount: 2, at, vClass: 'COMFORT' }).totalCents).toBe(1659);
  });
});
