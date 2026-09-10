import { describe, it, expect } from 'vitest';
import { canTransition, allowedNext, isTerminal } from '@/lib/status-machine';
import { haversineMeters, pointInPolygon, DEMO_CYPRUS_POLYGON, validCoord } from '@/lib/geo';
import { computeFreshness } from '@/lib/freshness';
import { bookingReference } from '@/lib/crypto';

describe('status machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('REQUESTED', 'ASSIGNED', 'STAFF')).toBe(true);
    expect(canTransition('REQUESTED', 'ASSIGNED', 'DRIVER')).toBe(false);
    expect(canTransition('ASSIGNED', 'EN_ROUTE', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELED', 'PASSENGER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELED', 'STAFF')).toBe(false); // only via terminate
  });
  it('forbids reopening terminal states', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELED')).toBe(true);
    expect(allowedNext('COMPLETED', 'STAFF')).toEqual([]);
    expect(canTransition('CANCELED', 'REQUESTED', 'STAFF')).toBe(false);
  });
  it('passenger can only cancel from pre-pickup states', () => {
    expect(canTransition('REQUESTED', 'CANCELED', 'PASSENGER')).toBe(true);
    expect(canTransition('ARRIVED', 'CANCELED', 'PASSENGER')).toBe(true);
  });
});

describe('geo', () => {
  it('measures distance', () => {
    const marina = { lat: 34.6706, lng: 33.0413 };
    const lca = { lat: 34.8751, lng: 33.6249 };
    const d = haversineMeters(marina, lca);
    expect(d).toBeGreaterThan(50000);
    expect(d).toBeLessThan(70000);
  });
  it('validates coordinates', () => {
    expect(validCoord({ lat: 34.6, lng: 33.0 })).toBe(true);
    expect(validCoord({ lat: 200, lng: 33.0 })).toBe(false);
    expect(validCoord({ lat: NaN, lng: 33 })).toBe(false);
  });
  it('point-in-polygon over Cyprus area', () => {
    expect(pointInPolygon({ lat: 34.9, lng: 33.2 }, DEMO_CYPRUS_POLYGON)).toBe(true);
    expect(pointInPolygon({ lat: 48.0, lng: 2.0 }, DEMO_CYPRUS_POLYGON)).toBe(false);
  });
});

describe('freshness', () => {
  it('classifies by age', () => {
    const now = new Date('2026-01-01T00:02:00Z');
    expect(computeFreshness(new Date('2026-01-01T00:01:50Z'), new Date('2026-01-01T00:01:50Z'), now)).toBe('fresh');
    expect(computeFreshness(new Date('2026-01-01T00:01:00Z'), new Date('2026-01-01T00:01:00Z'), now)).toBe('stale');
    expect(computeFreshness(new Date('2025-12-31T23:59:00Z'), new Date('2025-12-31T23:59:00Z'), now)).toBe('disconnected');
  });
});

describe('booking reference', () => {
  it('has expected shape', () => {
    expect(bookingReference()).toMatch(/^CY-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});
