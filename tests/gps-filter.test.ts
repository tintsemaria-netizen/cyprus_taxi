import { describe, it, expect } from 'vitest';
import { filterFix, initialFilterState, accuracyLevel, type Fix } from '@/lib/gpsFilter';

// ~0.001° lat ≈ 111 m.
const at = (t: number, dLat: number, acc = 8): Fix => ({ lat: 34.68 + dLat, lng: 33.045, accuracyM: acc, t: t * 1000 });
function run(fixes: Fix[]) {
  let s = initialFilterState();
  return fixes.map((f) => { const r = filterFix(s, f); s = r.state; return r.verdict; });
}

describe('gps filter', () => {
  it('accepts normal driving', () => {
    // 15 m/s ≈ 54 km/h
    expect(run([at(0, 0), at(1, 0.000135), at(2, 0.00027), at(3, 0.000405)])).toEqual(['accept', 'accept', 'accept', 'accept']);
  });
  it('ignores a poor fix while a good one is recent, uses it when nothing good for 30 s', () => {
    expect(run([at(0, 0), at(5, 0.001, 150)])).toEqual(['accept', 'poor']);
    expect(run([at(0, 0), at(31, 0.001, 150)])).toEqual(['accept', 'accept']);
    expect(run([at(0, 0, 300)])).toEqual(['accept']); // only rough fixes: still shown
  });
  it('ignores a sudden jump to the next street, accepts it when confirmed 3 times', () => {
    // 120 m in 1 s (~430 km/h) — a multipath jump
    expect(run([at(0, 0), at(1, 0.0011, 20), at(2, 0.00003)])).toEqual(['accept', 'jump', 'accept']);
    expect(run([at(0, 0), at(1, 0.0011, 20), at(2, 0.0011, 20), at(3, 0.0011, 20)])).toEqual(['accept', 'jump', 'jump', 'accept']);
  });
  it('accuracy level', () => {
    expect([accuracyLevel(8), accuracyLevel(35), accuracyLevel(120), accuracyLevel(null)]).toEqual(['good', 'fair', 'poor', null]);
  });
});
