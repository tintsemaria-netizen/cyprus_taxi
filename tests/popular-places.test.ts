import { describe, it, expect } from 'vitest';
import { matchPopular } from '@/lib/popularPlaces';

const limassol = { lat: 34.68, lng: 33.04 };
describe('popular places', () => {
  it('«пафос» offers Paphos airport first', () => {
    expect(matchPopular('пафос', limassol)[0].name).toBe('Paphos Airport (PFO)');
    expect(matchPopular('Πάφος', limassol)[0].name).toBe('Paphos Airport (PFO)');
    expect(matchPopular('pafos', null)[0].name).toBe('Paphos Airport (PFO)');
  });
  it('a kind of place: nearest town first, then further', () => {
    const near = matchPopular('аэропорт', { lat: 34.77, lng: 32.42 }).map((p) => p.name);
    expect(near).toEqual(['Paphos Airport (PFO)', 'Larnaca Airport (LCA)', 'Ercan Airport (ECN)']);
    const far = matchPopular('аэропорт', { lat: 34.92, lng: 33.63 }).map((p) => p.name);
    expect(far[0]).toBe('Larnaca Airport (LCA)');
    expect(matchPopular('марина', limassol)[0].name).toBe('Limassol Marina');
  });
  it('word starts, several words, nothing for unrelated text', () => {
    expect(matchPopular('пафос аэро', limassol).map((p) => p.name)).toEqual(['Paphos Airport (PFO)']);
    expect(matchPopular('qwerty', limassol)).toEqual([]);
    expect(matchPopular('a', limassol)).toEqual([]);
  });
});

import { fareRangeText } from '@/lib/price-type';
describe('driver price as the passenger sees it', () => {
  const m = (c: number) => `${(c / 100).toFixed(2)} €`;
  it('taximeter estimate → ±12 % range; fixed fare → one amount', () => {
    expect(fareRangeText(7011, 'REGULATED_METER_ESTIMATE', m)).toBe('61.70 €–78.52 €');
    expect(fareRangeText(3500, 'REGULATED_FIXED', m)).toBe('35.00 €');
    expect(fareRangeText(1000, null, m)).toBe('8.80 €–11.20 €');
  });
});
