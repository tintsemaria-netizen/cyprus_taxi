import { describe, it, expect } from 'vitest';
import { smoothRoute } from '@/components/routeSmooth';

describe('rounded route corners', () => {
  it('a right-angle turn becomes a short curve near the corner, ends kept', () => {
    const r: [number, number][] = [[33.0, 34.7], [33.01, 34.7], [33.01, 34.71]];
    const s = smoothRoute(r)!;
    expect(s[0]).toEqual(r[0]);
    expect(s[s.length - 1][0]).toBeCloseTo(33.01, 9);
    expect(s[s.length - 1][1]).toBeCloseTo(34.71, 9);
    expect(s.length).toBeGreaterThan(5);
    // The sharp corner point itself is no longer on the line; the curve stays within ~10 m of it.
    expect(s.some(([x, y]) => x === 33.01 && y === 34.7)).toBe(false);
    const near = s.filter(([x, y]) => Math.abs(x - 33.01) < 0.0003 && Math.abs(y - 34.7) < 0.0003);
    expect(near.length).toBeGreaterThan(3);
  });
  it('straight or short routes stay as they are', () => {
    const line: [number, number][] = [[33, 34.7], [33.005, 34.7], [33.01, 34.7]];
    expect(smoothRoute(line)).toEqual(line);
    expect(smoothRoute([[33, 34.7], [33.01, 34.7]])).toEqual([[33, 34.7], [33.01, 34.7]]);
    expect(smoothRoute(null)).toBeNull();
  });
});
