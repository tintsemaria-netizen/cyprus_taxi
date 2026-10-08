import { describe, it, expect } from 'vitest';
import { cumulative, locate, nextStep, distM, roundNavDistance, promptBand, maneuverIcon, type NavStep } from '@/lib/nav';
import { anchorSteps } from '@/server/google';

// A straight street north (~1.1 km), then a right turn east (~0.9 km). [lat, lng]
const path: [number, number][] = [];
for (let i = 0; i <= 10; i++) path.push([34.67 + i * 0.001, 33.04]);
for (let i = 1; i <= 10; i++) path.push([34.68, 33.04 + i * 0.001]);
const cum = cumulative(path);
const steps: NavStep[] = [
  { at: 0, maneuver: 'DEPART', text: 'Head north', distanceM: 1110 },
  { at: 10, maneuver: 'TURN_RIGHT', text: 'Turn right onto Main St', distanceM: 915 },
];

describe('driver navigation geometry', () => {
  it('cumulative distance matches the haversine sum', () => {
    expect(cum[10]).toBeGreaterThan(1100);
    expect(cum[10]).toBeLessThan(1125);
    expect(cum[cum.length - 1]).toBeCloseTo(cum[10] + distM({ lat: 34.68, lng: 33.04 }, { lat: 34.68, lng: 33.05 }), 0);
  });

  it('projects the car onto the route and reports the off-route distance', () => {
    const p = locate(path, cum, { lat: 34.6745, lng: 33.0402 }, 0)!; // ~18 m east of the street
    expect(p.seg).toBe(4);
    expect(p.offRouteM).toBeGreaterThan(10);
    expect(p.offRouteM).toBeLessThan(25);
    expect(p.alongM).toBeGreaterThan(cum[4]);
    expect(Math.round(p.bearing)).toBe(0); // heading north
    const far = locate(path, cum, { lat: 34.6745, lng: 33.046 }, 0)!;
    expect(far.offRouteM).toBeGreaterThan(400);
  });

  it('bearing follows the leg after the turn', () => {
    const p = locate(path, cum, { lat: 34.68, lng: 33.045 }, 0)!;
    expect(p.seg).toBeGreaterThanOrEqual(10);
    expect(Math.round(p.bearing)).toBe(90);
  });

  it('next manoeuvre is the turn, with the distance to it', () => {
    expect(nextStep(steps, cum, 0)).toMatchObject({ index: 0, inM: cum[10] }); // before moving: depart, distance to the turn
    const n = nextStep(steps, cum, cum[6])!;
    expect(n.step.maneuver).toBe('TURN_RIGHT');
    expect(Math.round(n.inM)).toBe(Math.round(cum[10] - cum[6]));
    expect(nextStep(steps, cum, cum[12])).toBeNull(); // past the last manoeuvre
  });

  it('rounds spoken distances and picks prompt bands once per threshold', () => {
    expect(roundNavDistance(37)).toEqual({ value: 40, unit: 'm' });
    expect(roundNavDistance(430)).toEqual({ value: 450, unit: 'm' });
    expect(roundNavDistance(1260)).toEqual({ value: 1.3, unit: 'km' });
    expect(promptBand(1500)).toBeNull();
    expect(promptBand(700)).toBe(800);
    expect(promptBand(200)).toBe(250);
    expect(promptBand(20)).toBe(40);
    expect(maneuverIcon('TURN_LEFT')).toBe('⬅');
    expect(maneuverIcon('SOMETHING_NEW')).toBe('⬆');
  });

  it('anchors Google steps to path vertices in route order', () => {
    const raw = [
      { distanceMeters: 1110, startLocation: { latLng: { latitude: 34.67, longitude: 33.04 } }, navigationInstruction: { maneuver: 'DEPART', instructions: 'Head north' } },
      { distanceMeters: 915, startLocation: { latLng: { latitude: 34.68001, longitude: 33.04 } }, navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: 'Turn right' } },
      { distanceMeters: 0, navigationInstruction: { maneuver: 'STRAIGHT' } }, // no location → skipped
    ];
    expect(anchorSteps(path, raw)).toEqual([
      { at: 0, maneuver: 'DEPART', text: 'Head north', distanceM: 1110 },
      { at: 10, maneuver: 'TURN_RIGHT', text: 'Turn right', distanceM: 915 },
    ]);
  });
});

describe('camera look-ahead', () => {
  it('offsets the camera along the heading', async () => {
    const { offsetPoint } = await import('@/lib/nav');
    const p = { lat: 34.68, lng: 33.04 };
    const north = offsetPoint(p, 0, 110), east = offsetPoint(p, 90, 110);
    expect(distM(p, north)).toBeCloseTo(110, 0);
    expect(north.lat).toBeGreaterThan(p.lat);
    expect(distM(p, east)).toBeCloseTo(110, 0);
    expect(east.lng).toBeGreaterThan(p.lng);
  });
});
