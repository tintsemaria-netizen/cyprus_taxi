import { describe, it, expect } from 'vitest';
import { isAirportPoint } from '@/lib/airports';

describe('airport zones (fixed-fare disclaimer + meeting-point arrival)', () => {
  it('detects LCA and PFO terminals', () => {
    expect(isAirportPoint(34.8751, 33.6249)).toBe(true); // LCA
    expect(isAirportPoint(34.718, 32.4857)).toBe(true); // PFO
    expect(isAirportPoint(34.885, 33.63)).toBe(true); // ~1.1 km from LCA
  });
  it('does not flag city points', () => {
    expect(isAirportPoint(34.6706, 33.0413)).toBe(false); // Limassol Marina
    expect(isAirportPoint(34.9167, 33.6333)).toBe(false); // Larnaca town centre (~4.6 km)
  });
});
