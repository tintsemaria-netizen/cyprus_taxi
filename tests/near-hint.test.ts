import { describe, it, expect } from 'vitest';
import { foldText, localMatches, nearParam, setNearHint } from '@/lib/nearHint';

describe('address search helpers', () => {
  it('folds Greek, accents and case so both spellings match', () => {
    expect(foldText('Αγίας Σοφίας')).toBe('agias sofias');
    expect(foldText('  Agiás  SOFIAS ')).toBe('agias sofias');
  });
  it('own places match by any words of the name or address, without duplicates', () => {
    const items = [
      { name: 'Мама', label: 'Molos 3, Limassol' },
      { label: 'Larnaca Airport (LCA)' },
      { label: 'Larnaca Airport (LCA)' },
      { label: 'Αγίας Σοφίας 12, Λεμεσός' },
    ];
    expect(localMatches(items, 'мама').map((i) => i.label)).toEqual(['Molos 3, Limassol']);
    expect(localMatches(items, 'larn air')).toHaveLength(1);
    expect(localMatches(items, 'agias 12')[0].label).toContain('Σοφίας');
    expect(localMatches(items, '')).toEqual([]);
  });
  it('near parameter from the hint or an explicit point', () => {
    expect(nearParam({ lat: 34.6712345, lng: 33.04 })).toBe('&near=34.6712,33.0400');
    setNearHint({ lat: 34.9, lng: 33.6 });
    expect(nearParam()).toBe('&near=34.9000,33.6000');
  });
});
