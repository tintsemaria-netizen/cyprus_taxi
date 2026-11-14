import { describe, it, expect } from 'vitest';
import { meterWaitingCents, meterWaitingRatePerHourCents } from '@/lib/tariff';

// Taximeter waiting (urban): €17.00/h day 06:01–20:30, €19.00/h night 20:31–06:00, Europe/Nicosia.
describe('meterWaitingCents', () => {
  it('day hour = €17, night hour = €19', () => {
    expect(meterWaitingCents(new Date('2026-01-02T08:00:00Z'), new Date('2026-01-02T09:00:00Z'))).toBe(1700); // 10:00–11:00 local
    expect(meterWaitingCents(new Date('2026-01-02T21:00:00Z'), new Date('2026-01-02T22:00:00Z'))).toBe(1900); // 23:00–00:00 local
  });
  it('splits at the 20:30/20:31 boundary', () => {
    // 20:29–20:33 local (UTC+2 in January): 2 min day + 2 min night = 56.67 + 63.33 = 120
    expect(meterWaitingCents(new Date('2026-01-02T18:29:00Z'), new Date('2026-01-02T18:33:00Z'))).toBe(120);
  });
  it('accrues per second and never negative', () => {
    expect(meterWaitingCents(new Date('2026-01-02T08:00:00Z'), new Date('2026-01-02T08:00:30Z'))).toBe(14); // 30 s × €17/h = 14.17
    expect(meterWaitingCents(new Date('2026-01-02T08:00:30Z'), new Date('2026-01-02T08:00:00Z'))).toBe(0);
  });
  it('rate for display', () => {
    expect(meterWaitingRatePerHourCents(new Date('2026-01-02T08:00:00Z'))).toBe(1700);
    expect(meterWaitingRatePerHourCents(new Date('2026-01-02T20:00:00Z'))).toBe(1900);
  });
});
