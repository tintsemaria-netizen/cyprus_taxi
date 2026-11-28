import { describe, it, expect } from 'vitest';
import { screenToWorld } from '@/components/mapFit';

// 2026-11-28: on a rotated Google map the centre-pin offset was applied as if north were up.
describe('screen offset on a rotated map', () => {
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };
  it('north up: screen = world', () => near(screenToWorld(10, 20, 0, 1), { x: 10, y: 20 }));
  it('east up (heading 90): screen down is west, screen right is south', () => {
    near(screenToWorld(0, 100, 90, 1), { x: -100, y: 0 });
    near(screenToWorld(100, 0, 90, 1), { x: 0, y: 100 });
  });
  it('south up (heading 180): everything flips', () => near(screenToWorld(30, 40, 180, 2), { x: -15, y: -20 }));
  it('the scale divides', () => near(screenToWorld(256, 0, 0, 256), { x: 1, y: 0 }));
});
