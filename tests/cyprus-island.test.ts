import { describe, it, expect } from 'vitest';
import { onCyprusIsland } from '@/lib/cyprus-island';

// Points on the island (incl. harbours, airports, the north) are allowed; the sea and abroad are not.
describe('onCyprusIsland', () => {
  it.each([
    ['Limassol Old Port', 34.6713, 33.0423], ['Larnaca airport', 34.8754, 33.6249], ['Paphos harbour', 34.7539, 32.4067],
    ['Ayia Napa marina', 34.9815, 34.0123], ['Nicosia', 35.1725, 33.3650], ['Troodos', 34.9230, 32.8800],
    ['Kyrenia harbour', 35.3418, 33.3196], ['Famagusta', 35.1230, 33.9440], ['Latchi', 35.0390, 32.3990], ['Polis', 35.0360, 32.4250],
    ['Akrotiri (UK base)', 34.59, 32.987], ['Dhekelia (UK base)', 34.98, 33.73], ['Larnaca marina', 34.9177, 33.6406],
  ])('%s is on the island', (_n, lat, lng) => { expect(onCyprusIsland({ lat, lng })).toBe(true); });
  it.each([
    ['3 km off Limassol', 34.62, 33.05], ['600 m past Limassol port', 34.660, 33.045], ['Larnaca bay', 34.85, 33.75], ['west of Paphos', 34.9, 32.1],
    ['Turkey', 36.2, 33.0], ['Beirut', 33.89, 35.5], ['NaN', Number.NaN, 33],
  ])('%s is not', (_n, lat, lng) => { expect(onCyprusIsland({ lat, lng })).toBe(false); });
});
