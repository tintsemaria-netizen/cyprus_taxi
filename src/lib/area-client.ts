import { onCyprusIsland } from './cyprus-island';
import { pointInPolygon } from './geo';
import { api } from './api-client';
import { setAirportAreas, zoneAirportAreas } from './airports';

// Where a passenger may put a point (2026-11-24): on the island of Cyprus and outside every active
// «Запретная зона». The zones come from /api/v1/no-go (refreshed every 5 min); the server checks again.
let zones: [number, number][][] = [];
/** Pickup territories (already rounded by the server): a pickup inside goes to one of their points. */
export interface Territory { name: string; polygon: [number, number][]; points: { lat: number; lng: number; name: string }[]; dropPoints?: { lat: number; lng: number; name: string }[]; airport?: string | null; nogo?: boolean }
let territories: Territory[] = [];
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function loadNoGo(): Promise<void> {
  if (loading) return loading;
  if (Date.now() - loadedAt < 5 * 60_000) return Promise.resolve();
  loading = api<{ zones: [number, number][][]; territories?: Territory[]; zoneSpots?: Territory[] }>('/no-go')
    .then((r) => {
      zones = r.zones ?? []; territories = [...(r.territories ?? []), ...(r.zoneSpots ?? [])]; loadedAt = Date.now(); // no-go zones with points next to them snap like territories (2026-11-26)
      // The airport is a territory marked «это аэропорт» (2026-11-25): the co-rider places use it here too.
      setAirportAreas([...territories.filter((t) => t.airport && !t.nogo).map((t) => ({ code: t.airport!, polygon: t.polygon })),
        ...territories.filter((t) => t.airport && t.nogo).flatMap((t) => zoneAirportAreas(t.airport!, t.polygon, [...t.points, ...(t.dropPoints ?? [])]))]); // a no-go zone + its points (2026-11-26)
    })
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

/** All pickup territories — drawn on the passenger map all the time (2026-11-24, operator). */
export const allTerritories = (): Territory[] => territories.filter((t) => !t.nogo && (t.points.length || t.dropPoints?.length)); // a bare territory (no points) is not drawn for the passenger
/** The territory with drop-off points a destination is in, with the drop-off point it is on (if any) and the
 *  nearest one (2026-11-24, operator: the airport's drop-off is not at the pickup points). */
export function dropTerritoryAt(p: { lat: number; lng: number }): { t: Territory; on: number; nearest: number } | null {
  for (const t of territories) {
    const pts = t.dropPoints ?? [];
    if (!pts.length || t.polygon.length < 3 || !pointInPolygon(p, t.polygon.map(([lat, lng]) => ({ lat, lng })))) continue;
    let nearest = 0, bd = Infinity, on = -1;
    pts.forEach((s, i) => {
      const d = (s.lat - p.lat) ** 2 + ((s.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
      if (d < bd) { bd = d; nearest = i; }
      if (Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6) on = i;
    });
    return { t, on, nearest };
  }
  return null;
}
export const dropLabel = (t: Territory, i: number) => { const s = (t.dropPoints ?? [])[i]; return s?.name ? `${t.name} · ${s.name}` : t.name; };
export const spotLabel = (t: Territory, i: number) => (t.points[i].name ? `${t.name} · ${t.points[i].name}` : t.name);

/** The pickup territory a point is in — or, with `radiusM`, the one whose edge is that close (2026-11-24, operator:
 *  at island zoom the airport is a dot; a logo let go next to it, even over the sea beside it, goes to its point). */
export function territoryNear(p: { lat: number; lng: number }, radiusM: number): { t: Territory; on: number; nearest: number } | null {
  const inside = territoryAt(p);
  if (inside || radiusM <= 0) return inside;
  const k = Math.cos((p.lat * Math.PI) / 180);
  let best: Territory | null = null, bd = Infinity;
  // «Next to» only for territories: next to a no-go zone, outside it, the pickup is fine where it is (2026-11-26).
  for (const t of territories) if (t.points.length && !t.nogo) for (const [la, ln] of t.polygon) {
    const d = Math.hypot((la - p.lat) * 110540, (ln - p.lng) * 111320 * k);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best || bd > radiusM) return null;
  let nearest = 0, nd = Infinity;
  best.points.forEach((s, i) => { const d = Math.hypot((s.lat - p.lat) * 110540, (s.lng - p.lng) * 111320 * k); if (d < nd) { nd = d; nearest = i; } });
  return { t: best, on: -1, nearest };
}

/** The pickup territory a point is in, with the point it is on (if any) and the nearest one. */
/** Is p inside t or within m metres of its outline (by corners — the rounded outline has dense corners)? */
export function nearTerritory(t: Territory, p: { lat: number; lng: number }, m: number): boolean {
  if (t.polygon.length >= 3 && pointInPolygon(p, t.polygon.map(([lat, lng]) => ({ lat, lng })))) return true;
  const k = Math.cos((p.lat * Math.PI) / 180);
  return t.polygon.some(([la, ln]) => Math.hypot((la - p.lat) * 110540, (ln - p.lng) * 111320 * k) <= m);
}

export function territoryAt(p: { lat: number; lng: number }): { t: Territory; on: number; nearest: number } | null {
  for (const t of territories) {
    if (!t.points.length) continue; // a territory without pickup points does not move the pickup (2026-11-25)
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

/**
 * The separate «Место подачи / назначения» map screen (operator 2026-11-26: it did not know the territories).
 * Pickup: let go inside or next to a territory (30 px, at most 1.5 km) → its nearest pickup point. Destination:
 * inside a territory with drop-off points → its nearest drop-off point. A stop is never moved.
 */
export function pickerSpot(kind: 'pickup' | 'dropoff' | 'stop', p: { lat: number; lng: number }, zoom: number): { lat: number; lng: number; label: string } | null {
  if (kind === 'pickup') {
    const mpp = (156543 * Math.cos((p.lat * Math.PI) / 180)) / 2 ** zoom;
    const tz = territoryNear(p, Math.min(1500, 30 * mpp));
    if (!tz) return null;
    const i = tz.on >= 0 ? tz.on : tz.nearest, sp = tz.t.points[i];
    return { lat: sp.lat, lng: sp.lng, label: spotLabel(tz.t, i) };
  }
  if (kind === 'dropoff') {
    const dz = dropTerritoryAt(p);
    if (!dz) return null;
    const i = dz.on >= 0 ? dz.on : dz.nearest, sp = dz.t.dropPoints![i];
    return { lat: sp.lat, lng: sp.lng, label: dropLabel(dz.t, i) };
  }
  return null;
}

/** Outlines for the picker map: territories with points of that kind within 2 km of the centre. */
export function pickerOutlines(kind: 'pickup' | 'dropoff' | 'stop', p: { lat: number; lng: number }): [number, number][][] {
  if (kind === 'stop') return [];
  return allTerritories().filter((t) => (kind === 'pickup' ? t.points.length : t.dropPoints?.length) && nearTerritory(t, p, 2000)).map((t) => t.polygon);
}
