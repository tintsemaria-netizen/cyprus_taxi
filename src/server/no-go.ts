import { z } from 'zod';
import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { smoothRing } from '@/lib/ring';
import { parsePolygon } from '@/server/fixed-fares';
import { AIRPORT_CODES, setAirportAreas } from '@/lib/airports';

// «Запретная зона» (2026-11-24, operator): red areas the taxi does not go to. No pickup, stop or destination
// inside an active zone — the booking, the price and a stop added on the way are refused (NO_GO_ZONE).

export interface NoGo { id: string; name: string; polygon: [number, number][] }
/** «Точки подачи» (2026-11-24): inside the territory every pickup goes to the nearest of its points. */
export interface Spot { lat: number; lng: number; name: string }
export interface PickupPoint extends NoGo { points: Spot[]; dropPoints: Spot[]; airport: string | null }
export const spotLabel = (zone: string, s: Spot) => (s.name ? `${zone} · ${s.name}` : zone);
function parseSpots(v: unknown): Spot[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number').map((x) => ({ lat: x.lat, lng: x.lng, name: typeof x.name === 'string' ? x.name : '' }));
}
let cache: { at: number; rows: NoGo[]; points: PickupPoint[] } | null = null;
const TTL_MS = 30_000;
export function invalidateNoGoCache(): void { cache = null; }

export async function noGoZones(now = Date.now()): Promise<NoGo[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  await load(now);
  return cache!.rows;
}
export async function pickupPoints(now = Date.now()): Promise<PickupPoint[]> {
  await load(now);
  return cache!.points;
}
async function load(now: number) {
  if (cache && now - cache.at < TTL_MS) return;
  const rows = await prisma.noGoZone.findMany({ where: { active: true } });
  // Territories are checked by their rounded outline — the shape the passenger sees.
  const z = (r: (typeof rows)[number]) => ({ id: r.id, name: r.name, polygon: (r.kind === 'POINT' ? smoothRing(parsePolygon(r.polygon) as [number, number][]) : parsePolygon(r.polygon)) as [number, number][] });
  cache = {
    at: now,
    rows: rows.filter((r) => r.kind !== 'POINT').map(z),
    points: rows.filter((r) => r.kind === 'POINT').map((r) => ({ ...z(r), points: parseSpots(r.points), dropPoints: parseSpots(r.dropPoints), airport: r.airport ?? null })).filter((t) => t.points.length > 0),
  };
  // The airport is a territory marked «это аэропорт» (2026-11-25) — by the same rounded outline the passenger sees.
  setAirportAreas(cache.points.filter((t) => t.airport).map((t) => ({ code: t.airport!, polygon: t.polygon })));
}
/** Load (or refresh, 30 s cache) the airport areas before a synchronous airportAt / isAirportPoint / shareZone. */
export async function ensureAirportAreas(now = Date.now()): Promise<void> { await load(now); }

const inside = (p: { lat: number; lng: number }, poly: [number, number][]) => poly.length >= 3 && pointInPolygon(p, poly.map(([lat, lng]) => ({ lat, lng })));

/** A pickup inside a pickup territory goes to one of its points: the one it already is on (chosen by the
 *  passenger), else the nearest — with «territory · point» as the label. */
export async function snapPickup<T extends { lat: number; lng: number; label?: string }>(p: T): Promise<T> {
  for (const z of await pickupPoints()) {
    if (!inside(p, z.polygon)) continue;
    let best = z.points[0], bd = Infinity;
    for (const s of z.points) { const d = (s.lat - p.lat) ** 2 + ((s.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; best = s; } }
    return { ...p, lat: best.lat, lng: best.lng, label: spotLabel(z.name, best) };
  }
  return p;
}

/** A destination inside a territory that has drop-off points goes to the nearest of them (2026-11-24, operator:
 *  the airport's drop-off is at Departures, not at the pickup points). No drop-off points → unchanged. */
export async function snapDropoff<T extends { lat: number; lng: number; label?: string }>(p: T): Promise<T> {
  for (const z of await pickupPoints()) {
    if (!z.dropPoints.length || !inside(p, z.polygon)) continue;
    let best = z.dropPoints[0], bd = Infinity;
    for (const s of z.dropPoints) { const d = (s.lat - p.lat) ** 2 + ((s.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; best = s; } }
    return { ...p, lat: best.lat, lng: best.lng, label: spotLabel(z.name, best) };
  }
  return p;
}

/** The active no-go zone the point is in, or null. */
export async function noGoAt(p: { lat: number; lng: number }): Promise<NoGo | null> {
  for (const z of await noGoZones()) if (inside(p, z.polygon)) return z;
  return null;
}

/** First of the points that is in a no-go zone: which one ('pickup' | 'stop' | 'dropoff'), or null. */
export async function firstNoGo(pts: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number }; stop?: { lat: number; lng: number } | null }) {
  for (const k of ['pickup', 'stop', 'dropoff'] as const) {
    const p = pts[k];
    if (p && (await noGoAt(p))) return k;
  }
  return null;
}

/** Pickup and drop-off points of one territory stay apart (operator 2026-11-24: «чтобы не переплетались»). */
export const MIN_PICK_DROP_M = 15;
export const noGoSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['NOGO', 'POINT']).optional(),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(400),
  points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().trim().max(60).default('') })).max(20).optional(),
  dropPoints: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().trim().max(60).default('') })).max(20).optional(),
  active: z.boolean().optional(),
  airport: z.enum(AIRPORT_CODES).nullable().optional(), // POINT only: «это аэропорт» (2026-11-25)
}).refine((d) => d.kind !== 'POINT' || (d.points?.length ?? 0) > 0, { message: 'At least one pickup point is required.' })
  // Every pickup point inside its (rounded) territory and on land (2026-11-24).
  .refine((d) => d.kind !== 'POINT' || [...(d.points ?? []), ...(d.dropPoints ?? [])].every((s) => onCyprusIsland(s) && pointInPolygon(s, smoothRing(d.polygon).map(([lat, lng]) => ({ lat, lng })))), { message: 'Pickup and drop-off points must be inside the territory, on land.' })
  // Pickup and drop-off points do not mix (operator: «чтобы не переплетались»): at least 15 m apart.
  .refine((d) => (d.points ?? []).every((a) => (d.dropPoints ?? []).every((b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)) >= MIN_PICK_DROP_M)), { message: `A drop-off point must be at least ${MIN_PICK_DROP_M} m from every pickup point.` });
export function noGoData(d: z.infer<typeof noGoSchema>) {
  return { name: d.name, kind: d.kind ?? 'NOGO', polygon: d.polygon, points: d.kind === 'POINT' ? (d.points ?? []) : undefined, dropPoints: d.kind === 'POINT' ? (d.dropPoints ?? []) : undefined, active: d.active ?? true,
    // Not sent (e.g. the on/off switch) → unchanged; a no-go zone is never an airport.
    ...(d.kind === 'POINT' ? (d.airport !== undefined ? { airport: d.airport } : {}) : { airport: null }) };
}
export const zoneView = (r: { points: unknown; dropPoints?: unknown; polygon: unknown } & Record<string, unknown>) =>
  ({ ...r, polygon: parsePolygon(r.polygon), points: parseSpots(r.points), dropPoints: parseSpots(r.dropPoints) });
