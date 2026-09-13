import { describe, it, expect } from 'vitest';
import { computeDynamicMultiplier, dynamicSurchargeCents, DYNAMIC_DEFAULTS } from '@/lib/pricing-dynamic';
import { getWeather } from '@/server/weather';

describe('dynamic pricing multiplier', () => {
  it('balanced supply/demand → no surge', () => {
    const r = computeDynamicMultiplier({ activeRequests: 3, availableDrivers: 3 });
    expect(r.multiplier).toBe(1.0);
    expect(r.applied).toBe(false);
  });

  it('demand above supply → surge, above 1.0', () => {
    const r = computeDynamicMultiplier({ activeRequests: 8, availableDrivers: 2 });
    expect(r.multiplier).toBeGreaterThan(1.0);
    expect(r.applied).toBe(true);
  });

  it('is capped at the max multiplier', () => {
    const r = computeDynamicMultiplier({ activeRequests: 100, availableDrivers: 1 }, { maxMultiplier: 1.5 });
    expect(r.multiplier).toBe(1.5);
    expect(r.reasons).toContain('capped');
  });

  it('zero supply is NOT an infinite fare — 1.0, not applied', () => {
    const r = computeDynamicMultiplier({ activeRequests: 50, availableDrivers: 0 });
    expect(r.multiplier).toBe(1.0);
    expect(r.applied).toBe(false);
    expect(r.demandSupplyRatio).toBeNull();
    expect(r.reasons).toContain('no-supply');
  });

  it('insufficient samples → 1.0', () => {
    const r = computeDynamicMultiplier({ activeRequests: 1, availableDrivers: 1 }); // sum 2 < 3
    expect(r.multiplier).toBe(1.0);
    expect(r.reasons).toContain('insufficient-samples');
  });

  it('bad weather raises the multiplier via the demand signal (never a separate stack)', () => {
    const dry = computeDynamicMultiplier({ activeRequests: 5, availableDrivers: 4, weatherSeverity: 0 });
    const wet = computeDynamicMultiplier({ activeRequests: 5, availableDrivers: 4, weatherSeverity: 1 });
    expect(wet.multiplier).toBeGreaterThanOrEqual(dry.multiplier);
    expect(wet.reasons.some((r) => r.startsWith('weather+'))).toBe(true);
    // Still bounded by the cap even with severe weather.
    expect(wet.multiplier).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.maxMultiplier);
  });

  it('hysteresis holds a near-equal previous multiplier', () => {
    // With a prev value one notch off but within a step, keep prev.
    const r = computeDynamicMultiplier({ activeRequests: 6, availableDrivers: 4, prevMultiplier: 1.2 });
    // The raw here is ~1 + (1.5-1)*0.35 = 1.175 → quantised 1.2; prev 1.2 → held.
    expect([1.2].includes(r.multiplier)).toBe(true);
  });

  it('surcharge applies only to the eligible base', () => {
    expect(dynamicSurchargeCents(1000, 1.5)).toBe(500);
    expect(dynamicSurchargeCents(1000, 1.0)).toBe(0);
    expect(dynamicSurchargeCents(1000, 0.9)).toBe(0);
  });
});

describe('weather adapter (default provider = none)', () => {
  it('returns a neutral, unavailable snapshot without inventing weather', async () => {
    const w = await getWeather(34.6706, 33.0413);
    expect(w.available).toBe(false);
    expect(w.severity).toBe(0);
    expect(w.provider).toBe('none');
    expect(w.observedAt).toBeNull();
  });
});
