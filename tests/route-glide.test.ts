import { describe, it, expect } from 'vitest';
import { glidePath } from '@/components/routeGlide';

// An L-shaped route: east 1 km, then north 1 km ([lng, lat]).
const route: [number, number][] = [[33.0, 34.70], [33.011, 34.70], [33.011, 34.709]];
const from = { lat: 34.70, lng: 33.005 };
const to = { lat: 34.705, lng: 33.011 };

describe('route glide (smooth car between GPS updates)', () => {
  it('follows the route around the corner instead of cutting it', () => {
    const f = glidePath(from, to, route);
    expect(f(0)).toEqual(from);
    expect(f(1)).toEqual(to);
    // Half way along the path (≈ 0.5 km east + 0.55 km north → about at the corner), not on the diagonal.
    const mid = f(0.5);
    expect(Math.abs(mid.lng - 33.011)).toBeLessThan(0.0008);
    expect(Math.abs(mid.lat - 34.70)).toBeLessThan(0.001);
  });
  it('straight line when off the route, going backwards or without a route', () => {
    const straightMid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
    expect(glidePath(from, to, null)(0.5)).toEqual(straightMid);
    expect(glidePath(to, from, route)(0.5)).toEqual(straightMid); // backwards
    const far = { lat: 34.72, lng: 33.03 };
    const g = glidePath(from, far, route)(0.5);
    expect(g.lat).toBeCloseTo((from.lat + far.lat) / 2, 6);
  });
});
