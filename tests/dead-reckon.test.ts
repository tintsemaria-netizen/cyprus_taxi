import { describe, it, expect } from 'vitest';
import { cumulative, deadReckon, distM, DR, locate, pointAlong } from '@/lib/nav';

// A straight 5 km road heading east near the A6 tunnels (34.698 N).
const path: [number, number][] = Array.from({ length: 51 }, (_, i) => [34.698, 32.80 + i * 0.001093]);
const cum = cumulative(path);
const start = { lat: 34.698, lng: 32.80 };

describe('dead reckoning through a tunnel (2026-11-20)', () => {
  it('pointAlong walks the path', () => {
    const p = pointAlong(path, cum, 1000)!;
    expect(Math.round(distM(start, p.point))).toBeGreaterThan(990);
    expect(Math.round(distM(start, p.point))).toBeLessThan(1010);
    expect(Math.round(p.bearing)).toBe(90);
  });

  it('keeps the car moving at its speed after the fix is lost (A6 tunnel, 100 km/h)', () => {
    const base = { path, cum, fromAlongM: 0, offRouteM: 3, speedKmh: 100, startMs: DR.startMs };
    expect(deadReckon({ ...base, ageMs: 1000 })).toBeNull();            // a normal gap between fixes
    const r = deadReckon({ ...base, ageMs: 20_000 })!;                    // 20 s inside the tunnel
    expect(Math.round(distM(start, r.point))).toBeGreaterThan(540);      // ≈ 556 m at 100 km/h
    expect(Math.round(distM(start, r.point))).toBeLessThan(570);
    expect(r.capped).toBe(false);
    const exit = deadReckon({ ...base, ageMs: 40_000 })!;                 // 950 m tunnel + approach
    expect(distM(start, exit.point)).toBeGreaterThan(1000);
    expect(exit.capped).toBe(false);
  });

  it('stops at 1.5 km / 120 s and does not move a standing or off-route car', () => {
    const base = { path, cum, fromAlongM: 0, offRouteM: 3, startMs: DR.startMs };
    const far = deadReckon({ ...base, speedKmh: 100, ageMs: 100_000 })!;
    expect(Math.round(distM(start, far.point))).toBeLessThanOrEqual(1501);
    expect(far.capped).toBe(true);
    const slow = deadReckon({ ...base, speedKmh: 40, ageMs: 200_000 })!;  // 120 s cap at 40 km/h = 1333 m
    expect(Math.round(distM(start, slow.point))).toBeLessThan(1340);
    expect(slow.capped).toBe(true);
    expect(deadReckon({ ...base, speedKmh: 5, ageMs: 20_000 })).toBeNull();
    expect(deadReckon({ ...base, speedKmh: 100, offRouteM: 120, ageMs: 20_000 })).toBeNull();
  });

  it('does not run past the end of the route', () => {
    const end = deadReckon({ path, cum, fromAlongM: cum[cum.length - 1] - 200, offRouteM: 2, speedKmh: 90, ageMs: 60_000, startMs: DR.startMs })!;
    expect(distM(end.point, { lat: path[path.length - 1][0], lng: path[path.length - 1][1] })).toBeLessThan(2);
    expect(end.capped).toBe(true);
    expect(locate(path, cum, end.point)!.offRouteM).toBeLessThan(1);
  });
});
