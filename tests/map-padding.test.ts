import { describe, it, expect } from 'vitest';
import { safePadding } from '@/components/mapFit';

// 2026-11-23: the booking «Выберите класс» sheet covers almost the whole map; its padding used to
// be taller than the map, and the map zoomed out to the whole world.
describe('map padding always leaves a usable box', () => {
  it('keeps the padding when it fits', () => {
    expect(safePadding({ top: 24, right: 32, bottom: 300, left: 32 }, 390, 844)).toEqual({ top: 24, right: 32, bottom: 300, left: 32 });
  });
  it('a sheet taller than the map → at least 40 px of the map stay free', () => {
    const p = safePadding({ top: 24, right: 32, bottom: 820, left: 32 }, 390, 844);
    expect(844 - p.top - p.bottom).toBeGreaterThanOrEqual(40);
    expect(p.bottom).toBeGreaterThan(p.top); // the big side gives up most
  });
  it('unknown size → unchanged', () => {
    expect(safePadding({ top: 1, right: 2, bottom: 3, left: 4 }, 0, 0)).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });
});
