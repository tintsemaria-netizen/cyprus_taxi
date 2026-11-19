import { describe, expect, it } from 'vitest';
import { isShareRoute, shareZone } from '@/lib/share';

describe('ride-share places', () => {
  it('includes Limassol (Germasogeia … Ypsonas) and pairs it with the other places', () => {
    expect(shareZone({ lat: 34.6932, lng: 33.0645 })).toBe('LIMASSOL'); // Germasogeia
    expect(isShareRoute({ lat: 34.6932, lng: 33.0645 }, { lat: 34.8751, lng: 33.6249 })).toBe(true); // → LCA
    expect(isShareRoute({ lat: 34.6786, lng: 33.0413 }, { lat: 35.17, lng: 33.36 })).toBe(true); // → Nicosia
    expect(isShareRoute({ lat: 34.6786, lng: 33.0413 }, { lat: 34.70, lng: 33.02 })).toBe(false); // inside Limassol
  });
});
