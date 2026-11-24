import { onCyprusIsland } from './cyprus-island';
import { pointInPolygon } from './geo';
import { api } from './api-client';

// Where a passenger may put a point (2026-11-24): on the island of Cyprus and outside every active
// «Запретная зона». The zones come from /api/v1/no-go (refreshed every 5 min); the server checks again.
let zones: [number, number][][] = [];
/** Pickup territories (already rounded by the server): a pickup inside goes to one of their points. */
export interface Territory { name: string; polygon: [number, number][]; points: { lat: number; lng: number; name: string }[] }
let territories: Territory[] = [];
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function loadNoGo(): Promise<void> {
  if (loading) return loading;
  if (Date.now() - loadedAt < 5 * 60_000) return Promise.resolve();
  loading = api<{ zones: [number, number][][]; territories?: Territory[] }>('/no-go')
    .then((r) => { zones = r.zones ?? []; territories = r.territories ?? []; loadedAt = Date.now(); })
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

export const spotLabel = (t: Territory, i: number) => (t.points[i].name ? `${t.name} · ${t.points[i].name}` : t.name);

/** The pickup territory a point is in, with the point it is on (if any) and the nearest one. */
export function territoryAt(p: { lat: number; lng: number }): { t: Territory; on: number; nearest: number } | null {
  for (const t of territories) {
    if (t.polygon.length < 3 || !pointInPolygon(p, t.polygon.map(([lat, lng]) => ({ lat, lng })))) continue;
    let nearest = 0, bd = Infinity, on = -1;
    t.points.forEach((s, i) => {
      const d = (s.lat - p.lat) ** 2 + ((s.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
      if (d < bd) { bd = d; nearest = i; }
      if (Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6) on = i;
    });
    return { t, on, nearest };
  }
  return null;
}
