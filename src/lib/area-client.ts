import { onCyprusIsland } from './cyprus-island';
import { pointInPolygon } from './geo';
import { api } from './api-client';

// Where a passenger may put a point (2026-11-24): on the island of Cyprus and outside every active
// «Запретная зона». The zones come from /api/v1/no-go (refreshed every 5 min); the server checks again.
let zones: [number, number][][] = [];
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function loadNoGo(): Promise<void> {
  if (loading) return loading;
  if (Date.now() - loadedAt < 5 * 60_000) return Promise.resolve();
  loading = api<{ zones: [number, number][][] }>('/no-go')
    .then((r) => { zones = r.zones ?? []; loadedAt = Date.now(); })
    .catch(() => { /* keep what we had; the server still refuses */ })
    .finally(() => { loading = null; });
  return loading;
}

/** Why a point is not allowed (an error code with a text in errors.ts), or null when it is fine. */
export function areaBlock(p: { lat: number; lng: number }): 'OFF_ISLAND' | 'NO_GO_ZONE' | null {
  if (!onCyprusIsland(p)) return 'OFF_ISLAND';
  for (const z of zones) if (z.length >= 3 && pointInPolygon(p, z.map(([lat, lng]) => ({ lat, lng })))) return 'NO_GO_ZONE';
  return null;
}
