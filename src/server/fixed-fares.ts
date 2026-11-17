// Fixed airport fares (2026-11-17). Zones are drawn by the operator in admin («Фиксированные
// цены»). A trip from an airport to a point inside one of that airport's active zones, or back
// (no intermediate stop), gets exactly the zone price — same day and night. Several matching
// zones (overlap) → the cheapest wins, so drawing a small inner zone inside a big one works.
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AIRPORTS, airportAt } from '@/lib/airports';
import { pointInPolygon, type LatLng } from '@/lib/geo';

export interface ZoneRow { id: string; airport: string; name: string; polygon: [number, number][]; comfortCents: number; xlCents: number; active: boolean }

let cache: { at: number; rows: ZoneRow[] } | null = null;
const TTL_MS = 30_000;

export function invalidateFixedFareCache(): void { cache = null; }

export function parsePolygon(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
}

async function activeZones(now = Date.now()): Promise<ZoneRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.fixedFareZone.findMany({ where: { active: true } });
  const out = rows.map((r) => ({ id: r.id, airport: r.airport, name: r.name, polygon: parsePolygon(r.polygon), comfortCents: r.comfortCents, xlCents: r.xlCents, active: r.active }));
  cache = { at: now, rows: out };
  return out;
}

export interface FixedFareMatch { zoneId: string; zoneName: string; airport: string; cents: number }

export async function findFixedFare(pickup: LatLng, dropoff: LatLng, vClass: string, stop?: LatLng | null): Promise<FixedFareMatch | null> {
  if (stop) return null; // a stop on the way is a different trip → meter
  const fromAirport = airportAt(pickup.lat, pickup.lng);
  const toAirport = airportAt(dropoff.lat, dropoff.lng);
  if (!fromAirport && !toAirport) return null;
  const zones = await activeZones();
  if (!zones.length) return null;
  // Airport → zone, or zone → airport.
  const cands: { airport: string; point: LatLng }[] = [];
  if (fromAirport) cands.push({ airport: fromAirport, point: dropoff });
  if (toAirport) cands.push({ airport: toAirport, point: pickup });
  let best: FixedFareMatch | null = null;
  for (const c of cands) {
    for (const z of zones) {
      if (z.airport !== c.airport || !pointInPolygon(c.point, z.polygon.map(([lat, lng]) => ({ lat, lng })))) continue;
      const cents = vClass === 'XL' ? z.xlCents : z.comfortCents;
      if (!best || cents < best.cents) best = { zoneId: z.id, zoneName: z.name, airport: z.airport, cents };
    }
  }
  return best;
}

/** Admin create/update payload. */
export const zoneSchema = z.object({
  airport: z.enum(AIRPORTS.map((a) => a.code) as [string, ...string[]]),
  name: z.string().trim().min(1).max(80),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(200),
  comfortCents: z.number().int().min(100).max(100_000),
  xlCents: z.number().int().min(100).max(100_000),
  active: z.boolean().optional(),
});
