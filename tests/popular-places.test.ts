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
    expect(near).toEqual(['Paphos Airport (PFO)', 'Larnaca Airport (LCA)']);
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
