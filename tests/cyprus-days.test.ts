import { describe, it, expect } from 'vitest';
import { nicosiaDayKey, startOfNicosiaDay } from '@/lib/timezone';
import { coarsenCoord } from '@/server/events';

describe('Cyprus calendar days (driver reporting)', () => {
  it('a shift after local midnight belongs to the new Cyprus day (summer, UTC+3)', () => {
    expect(nicosiaDayKey(new Date('2026-07-10T21:30:00Z'))).toBe('2026-07-11'); // 00:30 local
    expect(nicosiaDayKey(new Date('2026-07-10T20:59:00Z'))).toBe('2026-07-10'); // 23:59 local
    expect(startOfNicosiaDay(new Date('2026-07-10T21:30:00Z')).toISOString()).toBe('2026-07-10T21:00:00.000Z');
  });
  it('winter is UTC+2', () => {
    expect(nicosiaDayKey(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-16');
    expect(startOfNicosiaDay(new Date('2026-01-15T10:00:00Z')).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });
  it('day shifting works across the DST change (last Sunday of March 2026 = Mar 29)', () => {
    const d = new Date('2026-03-29T12:00:00Z');
    expect(startOfNicosiaDay(d).toISOString()).toBe('2026-03-28T22:00:00.000Z'); // midnight was still UTC+2
    expect(startOfNicosiaDay(d, 1).toISOString()).toBe('2026-03-29T21:00:00.000Z'); // next midnight is UTC+3
    expect(startOfNicosiaDay(d, -6).toISOString()).toBe('2026-03-22T22:00:00.000Z');
  });
});

describe('analytics coordinate coarsening', () => {
  it('snaps to a ~500 m grid', () => {
    expect(coarsenCoord(34.67061)).toBe(34.67);
    expect(coarsenCoord(34.67301)).toBe(34.675);
    expect(coarsenCoord(33.04131)).toBe(33.04);
    expect(Math.abs(coarsenCoord(34.6729) - 34.6729)).toBeLessThanOrEqual(0.0025);
  });
});
