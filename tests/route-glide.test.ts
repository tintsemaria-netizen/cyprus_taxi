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

import { trimRoute, offRouteM } from '@/components/routeGlide';
describe('route ahead of the car', () => {
  const route: [number, number][] = [[33.0, 34.7], [33.01, 34.7], [33.02, 34.7]];
  it('drops the part already driven (keeps ~40 m behind)', () => {
    const t = trimRoute(route, { lat: 34.7, lng: 33.012 });
    expect(t[t.length - 1]).toEqual([33.02, 34.7]);
    expect(t[0][0]).toBeGreaterThan(33.011); expect(t[0][0]).toBeLessThan(33.012);
  });
  it('keeps the whole route when the car is off it; distance to the line', () => {
    expect(trimRoute(route, { lat: 34.71, lng: 33.01 })).toBe(route);
    expect(offRouteM(route, { lat: 34.7, lng: 33.005 })).toBeLessThan(1);
    expect(offRouteM(route, { lat: 34.701, lng: 33.005 })).toBeGreaterThan(100);
  });
});

import { cameraFor } from '@/components/GoogleMapView';
describe('keep-in-view camera', () => {
  it('frames the points inside the padded area, not past street level', () => {
    const c = cameraFor([{ lat: 34.67, lng: 33.04 }, { lat: 34.70, lng: 33.08 }], 400, 800, { top: 60, right: 40, bottom: 300, left: 40 });
    expect(c.zoom).toBeGreaterThan(12); expect(c.zoom).toBeLessThan(15);
    expect(c.center.lat).toBeLessThan(34.70); expect(c.center.lat).toBeGreaterThan(34.64);
    expect(cameraFor([{ lat: 34.67, lng: 33.04 }, { lat: 34.67001, lng: 33.04001 }], 400, 800, { top: 0, right: 0, bottom: 0, left: 0 }).zoom).toBe(17);
  });
});
