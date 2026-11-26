import { describe, it, expect } from 'vitest';
import { meterWaitingCents, meterWaitingRatePerHourCents } from '@/lib/tariff';

// Taximeter waiting (urban): €17.00/h day 06:01–20:30, €19.00/h night 20:31–06:00, Europe/Nicosia.
describe('meterWaitingCents', () => {
  it('day hour = €17.85, night hour = €19.95 (published €17 / €19 + our 5 %)', () => {
    expect(meterWaitingCents(new Date('2026-01-02T08:00:00Z'), new Date('2026-01-02T09:00:00Z'))).toBe(1785); // 10:00–11:00 local
    expect(meterWaitingCents(new Date('2026-01-02T21:00:00Z'), new Date('2026-01-02T22:00:00Z'))).toBe(1995); // 23:00–00:00 local
  });
  it('splits at the 20:30/20:31 boundary', () => {
    // 20:29–20:33 local (UTC+2 in January): 2 min day + 2 min night = 56.67 + 63.33 = 120
    expect(meterWaitingCents(new Date('2026-01-02T18:29:00Z'), new Date('2026-01-02T18:33:00Z'))).toBe(126); // published 120 + 5 % (2026-11-26)
  });
  it('accrues per second and never negative', () => {
    expect(meterWaitingCents(new Date('2026-01-02T08:00:00Z'), new Date('2026-01-02T08:00:30Z'))).toBe(15); // 30 s × €17.85/h = 14.88
    expect(meterWaitingCents(new Date('2026-01-02T08:00:30Z'), new Date('2026-01-02T08:00:00Z'))).toBe(0);
  });
  it('rate for display', () => {
    expect(meterWaitingRatePerHourCents(new Date('2026-01-02T08:00:00Z'))).toBe(1785);
    expect(meterWaitingRatePerHourCents(new Date('2026-01-02T20:00:00Z'))).toBe(1995);
  });
});
