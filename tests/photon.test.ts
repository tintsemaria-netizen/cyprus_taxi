import { describe, it, expect } from 'vitest';
import { parsePhoton } from '@/server/photon';

const f = (properties: Record<string, string>, lng = 33.04, lat = 34.68) => ({ geometry: { coordinates: [lng, lat] }, properties: { countrycode: 'CY', ...properties } });
describe('Photon results', () => {
  it('streets, houses and hotels get a clear label and town', () => {
    const r = parsePhoton({ features: [
      f({ name: 'Agias Sofias', osm_key: 'highway', osm_value: 'residential', type: 'street', city: 'Limassol' }),
      f({ street: 'Agias Sofias', housenumber: '12', type: 'house', city: 'Limassol' }),
      f({ name: 'Amara', osm_key: 'tourism', osm_value: 'hotel', street: 'Amathountos', housenumber: '78', city: 'Limassol' }),
    ] });
    expect(r).toEqual([
      { label: 'Agias Sofias', secondary: 'Limassol', lat: 34.68, lng: 33.04, kind: 'street' },
      { label: 'Agias Sofias 12', secondary: 'Limassol', lat: 34.68, lng: 33.04 },
      { label: 'Amara', secondary: 'Amathountos 78, Limassol', lat: 34.68, lng: 33.04, kind: 'hotel' },
    ]);
  });
  it('skips other countries, nameless points and duplicates', () => {
    const r = parsePhoton({ features: [
      f({ name: 'X', countrycode: 'TR' }), f({ type: 'house' }),
      f({ name: 'Molos', city: 'Limassol' }), f({ name: 'Molos', city: 'Limassol' }),
    ] });
    expect(r.map((x) => x.label)).toEqual(['Molos']);
  });
});

import { latinize } from '@/server/photon';
describe('Russian-typed street names', () => {
  it('are spelled in Latin letters', () => {
    expect(latinize('макариоу')).toBe('makariou');
    expect(latinize('Агиас Софиас 12')).toBe('Agias Sofias 12');
  });
});
