import { z } from 'zod';
import { prisma } from '@/lib/db';
import { bookingMin, minFor, type MinMatch, type MinZone } from '@/lib/prebook-min';
import { parsePolygon } from '@/server/fixed-fares';

// Pre-booking minimum areas (2026-11-22), edited in admin «Минимум предзаказа». See src/lib/prebook-min.ts.

let cache: { at: number; rows: MinZone[] } | null = null;
const TTL_MS = 30_000;
export function invalidateMinFareCache(): void { cache = null; }

export async function minZones(now = Date.now()): Promise<MinZone[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.minFareZone.findMany({ where: { active: true } });
  const out = rows.map((r) => ({ id: r.id, name: r.name, polygon: parsePolygon(r.polygon), comfortCents: r.comfortCents, xlCents: r.xlCents }));
  cache = { at: now, rows: out };
  return out;
}

export async function prebookMin(t: Parameters<typeof minFor>[1]): Promise<MinMatch | null> {
  return minFor(await minZones(), t);
}
export async function bookingMinCents(b: Parameters<typeof bookingMin>[1]): Promise<number | null> {
  return bookingMin(await minZones(), b)?.cents ?? null;
}

export const minZoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(400),
  comfortCents: z.number().int().min(100).max(100_000),
  xlCents: z.number().int().min(100).max(100_000),
  active: z.boolean().optional(),
});
export function minZoneData(d: z.infer<typeof minZoneSchema>) {
  return { name: d.name, polygon: d.polygon, comfortCents: d.comfortCents, xlCents: d.xlCents, active: d.active ?? true };
}
