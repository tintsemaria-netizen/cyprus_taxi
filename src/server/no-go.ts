import { z } from 'zod';
import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { parsePolygon } from '@/server/fixed-fares';

// «Запретная зона» (2026-11-24, operator): red areas the taxi does not go to. No pickup, stop or destination
// inside an active zone — the booking, the price and a stop added on the way are refused (NO_GO_ZONE).

export interface NoGo { id: string; name: string; polygon: [number, number][] }
let cache: { at: number; rows: NoGo[] } | null = null;
const TTL_MS = 30_000;
export function invalidateNoGoCache(): void { cache = null; }

export async function noGoZones(now = Date.now()): Promise<NoGo[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.noGoZone.findMany({ where: { active: true } });
  const out = rows.map((r) => ({ id: r.id, name: r.name, polygon: parsePolygon(r.polygon) as [number, number][] }));
  cache = { at: now, rows: out };
  return out;
}

/** The active no-go zone the point is in, or null. */
export async function noGoAt(p: { lat: number; lng: number }): Promise<NoGo | null> {
  for (const z of await noGoZones()) {
    if (z.polygon.length >= 3 && pointInPolygon(p, z.polygon.map(([lat, lng]) => ({ lat, lng })))) return z;
  }
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
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(400),
  active: z.boolean().optional(),
});
