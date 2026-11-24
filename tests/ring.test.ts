import { describe, it, expect } from 'vitest';
import { addToRing, untangle, selfCrossing, type Pt } from '@/lib/ring';

describe('zone ring', () => {
  it('a figure-8 is untangled into one loop with the same corners', () => {
    const eight: Pt[] = [[0, 0], [1, 1], [1, 0], [0, 1]];
    expect(selfCrossing(eight)).toBe(true);
    const r = untangle(eight);
    expect(selfCrossing(r)).toBe(false);
    expect(r.slice().sort()).toEqual(eight.slice().sort());
  });
  it('corners clicked in any order end up as a ring', () => {
    const circle: Pt[] = Array.from({ length: 16 }, (_, i) => [34.75 + 0.05 * Math.sin((i * 2 * Math.PI) / 16), 32.45 + 0.06 * Math.cos((i * 2 * Math.PI) / 16)] as Pt);
    const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    let ring: Pt[] = [];
    for (const i of order) ring = addToRing(ring, circle[i]);
    expect(ring).toHaveLength(16);
    expect(selfCrossing(ring)).toBe(false);
  });
  it('a clean ring is left as it is', () => {
    const sq: Pt[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(untangle(sq)).toEqual(sq);
  });
});
