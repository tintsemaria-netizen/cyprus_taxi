import { z } from 'zod';
import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { parsePolygon } from '@/server/fixed-fares';

// «Запретная зона» (2026-11-24, operator): red areas the taxi does not go to. No pickup, stop or destination
// inside an active zone — the booking, the price and a stop added on the way are refused (NO_GO_ZONE).

export interface NoGo { id: string; name: string; polygon: [number, number][] }
/** «Одна точка подачи» (2026-11-24): inside the territory every pickup goes to this one point. */
export interface PickupPoint extends NoGo { lat: number; lng: number }
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
  const z = (r: (typeof rows)[number]) => ({ id: r.id, name: r.name, polygon: parsePolygon(r.polygon) as [number, number][] });
  cache = {
    at: now,
    rows: rows.filter((r) => r.kind !== 'POINT').map(z),
    points: rows.filter((r) => r.kind === 'POINT' && r.pointLat != null && r.pointLng != null).map((r) => ({ ...z(r), lat: r.pointLat!, lng: r.pointLng! })),
  };
}

const inside = (p: { lat: number; lng: number }, poly: [number, number][]) => poly.length >= 3 && pointInPolygon(p, poly.map(([lat, lng]) => ({ lat, lng })));

/** A pickup inside a «one pickup point» territory goes to that point (with its name as the label). */
export async function snapPickup<T extends { lat: number; lng: number; label?: string }>(p: T): Promise<T> {
  for (const z of await pickupPoints()) if (inside(p, z.polygon)) return { ...p, lat: z.lat, lng: z.lng, label: z.name };
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
  point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  active: z.boolean().optional(),
}).refine((d) => d.kind !== 'POINT' || !!d.point, { message: 'A pickup point is required.' });
export function noGoData(d: z.infer<typeof noGoSchema>) {
  const point = d.kind === 'POINT' ? d.point : null;
  return { name: d.name, kind: d.kind ?? 'NOGO', polygon: d.polygon, pointLat: point?.lat ?? null, pointLng: point?.lng ?? null, active: d.active ?? true };
}
export const zoneView = (r: { pointLat: number | null; pointLng: number | null; polygon: unknown } & Record<string, unknown>) =>
  ({ ...r, polygon: parsePolygon(r.polygon), point: r.pointLat != null && r.pointLng != null ? { lat: r.pointLat, lng: r.pointLng } : null });
