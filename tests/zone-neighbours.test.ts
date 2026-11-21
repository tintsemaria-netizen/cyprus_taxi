import { it, expect } from 'vitest';
import { shrinkInto, growAround, polygonInside, nextBelt } from '@/lib/zone-shapes';
it('neighbours follow', () => {
  const inner: [number, number][] = [[34.70, 32.46], [34.70, 32.51], [34.74, 32.51], [34.74, 32.46]];
  const belt = nextBelt(inner, 3000);
  // pull one belt corner deep into the inner zone
  const cut = belt.map((p, i) => (i === 3 ? [34.72, 32.47] as [number, number] : p));
  const shrunk = shrinkInto(inner, cut);
  expect(polygonInside(shrunk, cut)).toBe(true);
  expect(shrinkInto(inner, belt)).toBe(inner); // untouched when nothing cuts in
  // push an inner corner out over the belt
  const out = inner.map((p, i) => (i === 2 ? [34.80, 32.53] as [number, number] : p));
  const grown = growAround(belt, out);
  expect(polygonInside(out, grown)).toBe(true);
  expect(growAround(belt, inner)).toBe(belt);
});
