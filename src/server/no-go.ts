import { z } from 'zod';
import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { smoothRing } from '@/lib/ring';
import { parsePolygon } from '@/server/fixed-fares';

// «Запретная зона» (2026-11-24, operator): red areas the taxi does not go to. No pickup, stop or destination
// inside an active zone — the booking, the price and a stop added on the way are refused (NO_GO_ZONE).

export interface NoGo { id: string; name: string; polygon: [number, number][] }
/** «Точки подачи» (2026-11-24): inside the territory every pickup goes to the nearest of its points. */
export interface Spot { lat: number; lng: number; name: string }
export interface PickupPoint extends NoGo { points: Spot[] }
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
    points: rows.filter((r) => r.kind === 'POINT').map((r) => ({ ...z(r), points: parseSpots(r.points) })).filter((t) => t.points.length > 0),
  };
}

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

export const noGoSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['NOGO', 'POINT']).optional(),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(400),
  points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().trim().max(60).default('') })).max(20).optional(),
  active: z.boolean().optional(),
}).refine((d) => d.kind !== 'POINT' || (d.points?.length ?? 0) > 0, { message: 'At least one pickup point is required.' })
  // Every pickup point inside its (rounded) territory and on land (2026-11-24).
  .refine((d) => d.kind !== 'POINT' || (d.points ?? []).every((s) => onCyprusIsland(s) && pointInPolygon(s, smoothRing(d.polygon).map(([lat, lng]) => ({ lat, lng })))), { message: 'Pickup points must be inside the territory, on land.' });
export function noGoData(d: z.infer<typeof noGoSchema>) {
  return { name: d.name, kind: d.kind ?? 'NOGO', polygon: d.polygon, points: d.kind === 'POINT' ? (d.points ?? []) : undefined, active: d.active ?? true };
}
export const zoneView = (r: { points: unknown; polygon: unknown } & Record<string, unknown>) =>
  ({ ...r, polygon: parsePolygon(r.polygon), points: parseSpots(r.points) });
