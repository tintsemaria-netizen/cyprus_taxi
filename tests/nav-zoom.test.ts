import { describe, it, expect } from 'vitest';
import { navZoomForSpeed, nextNavZoom, smoothSpeed, NAV_ZOOM_MAX, NAV_ZOOM_MIN } from '@/lib/nav-zoom';

describe('speed-dependent navigation zoom', () => {
  it('street level when slow, widest on the motorway, in between in town', () => {
    expect(navZoomForSpeed(0)).toBe(NAV_ZOOM_MAX);
    expect(navZoomForSpeed(20)).toBe(NAV_ZOOM_MAX);
    expect(navZoomForSpeed(50)).toBeCloseTo(16.3, 5);
    expect(navZoomForSpeed(80)).toBeCloseTo(15.7, 5);
    expect(navZoomForSpeed(110)).toBe(NAV_ZOOM_MIN);
    expect(navZoomForSpeed(160)).toBe(NAV_ZOOM_MIN);
  });
  it('city zoom-out is smaller than motorway zoom-out', () => {
    expect(NAV_ZOOM_MAX - navZoomForSpeed(50)).toBeLessThan(NAV_ZOOM_MAX - navZoomForSpeed(110));
  });
  it('moves gradually, both out (accelerating) and back in (slowing)', () => {
    let z = 17;
    z = nextNavZoom(z, 15); expect(z).toBe(16.7);
    z = nextNavZoom(z, 15); expect(z).toBe(16.4);
    let back = 15; back = nextNavZoom(back, 17); expect(back).toBe(15.3);
  });
  it('ignores tiny changes (no pumping)', () => {
    expect(nextNavZoom(16.3, 16.4)).toBe(16.3);
  });
  it('smooths speed and drops absurd samples', () => {
    expect(smoothSpeed(null, 50)).toBe(50);
    expect(smoothSpeed(50, 100)).toBeCloseTo(67.5, 5);
    expect(smoothSpeed(50, 1000)).toBeCloseTo(50 + 0.35 * 150, 5);
    expect(smoothSpeed(40, NaN)).toBe(40);
  });
});
