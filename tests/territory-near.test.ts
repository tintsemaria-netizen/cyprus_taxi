import { describe, it, expect, vi, beforeAll } from 'vitest';

// Pickup territory «magnet» (2026-11-24): a logo let go next to the airport's circle — even over the sea beside
// it — goes to its point; far away it does not.
vi.mock('@/lib/api-client', () => ({
  api: async () => ({ zones: [], territories: [{ name: 'PFO', polygon: [[34.7215, 32.4790], [34.7210, 32.4900], [34.7135, 32.4915], [34.7125, 32.4800]], points: [{ lat: 34.7172, lng: 32.4842, name: 'Exit' }] }] }),
}));
import { loadNoGo, territoryNear, territoryAt } from '@/lib/area-client';

describe('territoryNear', () => {
  beforeAll(async () => { await loadNoGo(); });
  it('inside → the territory', () => { expect(territoryAt({ lat: 34.717, lng: 32.485 })?.t.name).toBe('PFO'); });
  it('400 m outside, radius 1500 m → the territory, nearest point', () => {
    const r = territoryNear({ lat: 34.7090, lng: 32.4850 }, 1500);
    expect(r?.t.name).toBe('PFO'); expect(r?.nearest).toBe(0); expect(r?.on).toBe(-1);
  });
  it('400 m outside, radius 100 m → none', () => { expect(territoryNear({ lat: 34.7090, lng: 32.4850 }, 100)).toBeNull(); });
  it('10 km away → none', () => { expect(territoryNear({ lat: 34.80, lng: 32.45 }, 1500)).toBeNull(); });
});
