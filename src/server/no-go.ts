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
export interface PickupPoint extends NoGo { points: Spot[]; dropPoints: Spot[]; airport: string | null; minComfortCents: number | null; minXlCents: number | null; minActive: boolean; pointsActive: boolean }
export const spotLabel = (zone: string, s: Spot) => (s.name ? `${zone} · ${s.name}` : zone);
function parseSpots(v: unknown): Spot[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number').map((x) => ({ lat: x.lat, lng: x.lng, name: typeof x.name === 'string' ? x.name : '' }));
}
/** «Стоянка с очередью» (2026-11-25): `active` = the queue is on; off = drivers standing there get no orders. */
export interface Stand extends NoGo { active: boolean; airport: string | null; forZoneId: string | null }
let cache: { at: number; rows: NoGo[]; points: PickupPoint[]; stands: Stand[] } | null = null;
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
  // Stands are loaded switched on AND off (off still matters: no orders there); the other kinds only when on.
  const rows = (await prisma.noGoZone.findMany()).filter((r) => r.active || r.kind === 'STAND');
  // Territories are checked by their rounded outline — the shape the passenger sees.
  const z = (r: (typeof rows)[number]) => ({ id: r.id, name: r.name, polygon: (r.kind === 'POINT' ? smoothRing(parsePolygon(r.polygon) as [number, number][]) : parsePolygon(r.polygon)) as [number, number][] });
  cache = {
    at: now,
    rows: rows.filter((r) => r.kind === 'NOGO').map(z),
    points: rows.filter((r) => r.kind === 'POINT').map((r) => ({ ...z(r), points: parseSpots(r.points), dropPoints: parseSpots(r.dropPoints), airport: r.airport ?? null, minComfortCents: r.minComfortCents ?? null, minXlCents: r.minXlCents ?? null, minActive: r.minActive, pointsActive: r.pointsActive })),
    stands: rows.filter((r) => r.kind === 'STAND').map((r) => ({ ...z(r), active: r.active, airport: r.airport ?? null, forZoneId: r.forZoneId ?? null })),
  };
  // The airport is a territory marked «это аэропорт» (2026-11-25) — by the same rounded outline the passenger sees.
  setAirportAreas(cache.points.filter((t) => t.airport).map((t) => ({ code: t.airport!, polygon: t.polygon })));
}
export async function taxiStands(now = Date.now()): Promise<Stand[]> {
  await load(now);
  return cache!.stands;
}
/** Load (or refresh, 30 s cache) the airport areas before a synchronous airportAt / isAirportPoint / shareZone. */
export async function ensureAirportAreas(now = Date.now()): Promise<void> { await load(now); }

const inside = (p: { lat: number; lng: number }, poly: [number, number][]) => poly.length >= 3 && pointInPolygon(p, poly.map(([lat, lng]) => ({ lat, lng })));

/** A pickup inside a pickup territory goes to one of its points: the one it already is on (chosen by the
 *  passenger), else the nearest — with «territory · point» as the label. */
export async function snapPickup<T extends { lat: number; lng: number; label?: string }>(p: T): Promise<T> {
  for (const z of await pickupPoints()) {
    if (!z.pointsActive || !z.points.length || !inside(p, z.polygon)) continue; // no (or switched-off) pickup points → the pickup stays as it is
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
    if (!z.pointsActive || !z.dropPoints.length || !inside(p, z.polygon)) continue;
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
export const noGoSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['NOGO', 'POINT', 'STAND']).optional(),
  polygon: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(3).max(400),
  points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().trim().max(60).default('') })).max(20).optional(),
  dropPoints: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().trim().max(60).default('') })).max(20).optional(),
  active: z.boolean().optional(),
  airport: z.enum(AIRPORT_CODES).nullable().optional(), // POINT: «это аэропорт» (2026-11-25); STAND: whose orders the queue takes
  // POINT: «минимальный заказ отсюда» (2026-11-25), € cents; null = none, absent = unchanged.
  minComfortCents: z.number().int().min(100).max(100_000).nullable().optional(),
  minXlCents: z.number().int().min(100).max(100_000).nullable().optional(),
  minActive: z.boolean().optional(), // the switch; absent = unchanged
  pointsActive: z.boolean().optional(), // «Точки подачи и высадки» switch; absent = unchanged
  forZoneId: z.string().max(64).nullable().optional(), // STAND: the pickup territory whose orders it takes
}).refine((d) => d.kind !== 'STAND' || !(d.airport === null && !d.forZoneId), { message: 'Choose the territory whose orders this stand takes.' })
  // A territory may have no pickup points (operator 2026-11-25): then it only marks a place (fixed fares, minimum
  // from here, a queue stand) and a pickup inside it stays where the passenger put it.
  // Every pickup point inside its (rounded) territory and on land (2026-11-24).
  .refine((d) => d.kind !== 'POINT' || [...(d.points ?? []), ...(d.dropPoints ?? [])].every((s) => onCyprusIsland(s) && pointInPolygon(s, smoothRing(d.polygon).map(([lat, lng]) => ({ lat, lng })))), { message: 'Pickup and drop-off points must be inside the territory, on land.' });
// Pickup and drop-off points may stand on one spot (operator 2026-11-26; was ≥ 15 m apart).
export function noGoData(d: z.infer<typeof noGoSchema>) {
  return { name: d.name, kind: d.kind ?? 'NOGO', polygon: d.polygon, points: d.kind === 'POINT' ? (d.points ?? []) : undefined, dropPoints: d.kind === 'POINT' ? (d.dropPoints ?? []) : undefined, active: d.active ?? true,
    // Not sent (e.g. the on/off switch) → unchanged; a no-go zone is never an airport.
    ...(d.kind === 'POINT' || d.kind === 'STAND' ? (d.airport !== undefined ? { airport: d.airport } : {}) : { airport: null }),
    ...(d.kind === 'STAND' ? (d.forZoneId !== undefined ? { forZoneId: d.forZoneId } : {}) : { forZoneId: null }),
    ...(d.kind === 'POINT' ? { ...(d.minComfortCents !== undefined ? { minComfortCents: d.minComfortCents } : {}), ...(d.minXlCents !== undefined ? { minXlCents: d.minXlCents } : {}), ...(d.minActive !== undefined ? { minActive: d.minActive } : {}), ...(d.pointsActive !== undefined ? { pointsActive: d.pointsActive } : {}) } : { minComfortCents: null, minXlCents: null }) };
}
export const zoneView = (r: { points: unknown; dropPoints?: unknown; polygon: unknown } & Record<string, unknown>) =>
  ({ ...r, polygon: parsePolygon(r.polygon), points: parseSpots(r.points), dropPoints: parseSpots(r.dropPoints) });

/**
 * «Минимальный заказ отсюда» (operator 2026-11-25): a ride picked up in a pickup territory with a minimum costs at
 * least that much (Comfort / XL), above it the meter. The pickup is inside the (rounded) territory or on one of its
 * exit points (they may sit right on the edge).
 */
export async function pointMin(pickup: { lat: number; lng: number }, vClass: string): Promise<{ cents: number; zone: string } | null> {
  let best: { cents: number; zone: string } | null = null;
  for (const t of await pickupPoints()) {
    const cents = vClass === 'XL' ? t.minXlCents : t.minComfortCents;
    if (!cents || !t.minActive) continue; // switched off in admin → the amounts are kept but do not apply
    const onSpot = t.points.some((s) => Math.hypot((s.lat - pickup.lat) * 110540, (s.lng - pickup.lng) * 111320 * Math.cos((pickup.lat * Math.PI) / 180)) <= 30);
    if (!onSpot && !inside(pickup, t.polygon)) continue;
    if (!best || cents > best.cents) best = { cents, zone: t.name };
  }
  return best;
}
