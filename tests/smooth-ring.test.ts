import { describe, it, expect } from 'vitest';
import { smoothRing } from '@/lib/ring';
import { pointInPolygon } from '@/lib/geo';

describe('smoothRing (rounded pickup territory, 2026-11-24)', () => {
  const sq: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
  it('rounds the corners: more points, corners cut, centre still inside', () => {
    const r = smoothRing(sq);
    expect(r.length).toBe(32);
    expect(r.some(([a, b]) => a === 0 && b === 0)).toBe(false);
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, r.map(([lat, lng]) => ({ lat, lng })))).toBe(true);
    expect(pointInPolygon({ lat: 0.02, lng: 0.02 }, r.map(([lat, lng]) => ({ lat, lng })))).toBe(false);
  });
  it('leaves fewer than 3 points as they are', () => { expect(smoothRing([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]); });
});
