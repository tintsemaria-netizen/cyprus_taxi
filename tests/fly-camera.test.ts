import { describe, it, expect, vi, afterEach } from 'vitest';
import { flyCamera } from '@/components/GoogleMapView';

// The live-trip framing flight (2026-11-27, operator: the camera reached the car in jumps): one continuous
// move — no frame jumps far, a long hop zooms out on the way, and it ends exactly on the target.
afterEach(() => vi.unstubAllGlobals());

function run(from: { lat: number; lng: number; zoom: number }, to: { lat: number; lng: number; zoom: number }) {
  let t = 0; const q: ((n: number) => void)[] = [];
  vi.stubGlobal('performance', { now: () => t });
  vi.stubGlobal('requestAnimationFrame', (f: (n: number) => void) => { q.push(f); return q.length; });
  let cam = { ...from };
  const frames: { lat: number; lng: number; zoom: number }[] = [];
  const map = { getCenter: () => ({ lat: () => cam.lat, lng: () => cam.lng }), getZoom: () => cam.zoom,
    moveCamera: (c: { center: { lat: number; lng: number }; zoom: number }) => { cam = { ...c.center, zoom: c.zoom }; frames.push(cam); } };
  let done = false;
  flyCamera(map, to, 390, 600, 1500, () => {}, () => { done = true; });
  while (q.length) { t += 16; q.shift()!(t); }
  return { frames, done, cam };
}

describe('flyCamera', () => {
  it('Nicosia → Limassol: zooms out on the way, every frame a small step, ends on the target', () => {
    const r = run({ lat: 35.17, lng: 33.36, zoom: 14 }, { lat: 34.69, lng: 33.06, zoom: 15 });
    expect(r.done).toBe(true);
    expect(r.cam.zoom).toBeCloseTo(15, 5);
    expect(r.cam.lat).toBeCloseTo(34.69, 5);
    expect(Math.min(...r.frames.map((f) => f.zoom))).toBeLessThan(12);
    for (let i = 1; i < r.frames.length; i++) {
      expect(Math.abs(r.frames[i].zoom - r.frames[i - 1].zoom)).toBeLessThan(0.3);
      // no frame moves more than ~half a screen at its zoom
      const px = Math.abs(r.frames[i].lat - r.frames[i - 1].lat) * 256 * 2 ** r.frames[i].zoom / 180;
      expect(px).toBeLessThan(300);
    }
  });
  it('a short hop does not zoom out', () => {
    const r = run({ lat: 34.690, lng: 33.060, zoom: 15 }, { lat: 34.692, lng: 33.061, zoom: 15.5 });
    expect(Math.min(...r.frames.map((f) => f.zoom))).toBeGreaterThan(14.99);
  });
});
