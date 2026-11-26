import { z } from 'zod';
import { prisma } from '@/lib/db';
import { pointInPolygon } from '@/lib/geo';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { smoothRing } from '@/lib/ring';
import { parsePolygon } from '@/server/fixed-fares';
import { AIRPORT_CODES, setAirportAreas, zoneAirportAreas } from '@/lib/airports';

// «Запретная зона» (2026-11-24, operator): red areas the taxi does not go to. No pickup, stop or destination
// inside an active zone — the booking, the price and a stop added on the way are refused (NO_GO_ZONE).

export interface NoGo { id: string; name: string; polygon: [number, number][] }
/** A «Запретная зона» with pickup / drop-off points NEXT TO it (operator 2026-11-26): the taxi does not drive in;
 *  a pickup put inside goes to the nearest pickup point, a destination inside to the nearest drop-off point. */
export interface NoGoSpots extends NoGo { points: Spot[]; dropPoints: Spot[]; airport: string | null; minComfortCents: number | null; minXlCents: number | null; minActive: boolean }
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
let cache: { at: number; rows: NoGo[]; points: PickupPoint[]; stands: Stand[]; nogoSpots: NoGoSpots[] } | null = null;
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
    nogoSpots: rows.filter((r) => r.kind === 'NOGO' && r.pointsActive).map((r) => ({ ...z(r), points: parseSpots(r.points), dropPoints: parseSpots(r.dropPoints), airport: r.airport ?? null, minComfortCents: r.minComfortCents ?? null, minXlCents: r.minXlCents ?? null, minActive: r.minActive })).filter((n) => n.points.length || n.dropPoints.length),
    stands: rows.filter((r) => r.kind === 'STAND').map((r) => ({ ...z(r), active: r.active, airport: r.airport ?? null, forZoneId: r.forZoneId ?? null })),
  };
  // The airport is a territory marked «это аэропорт» (2026-11-25) — by the same rounded outline the passenger sees.
  // …or (2026-11-26) a no-go zone chosen on the fixed-prices page: the zone plus its points next to it.
  setAirportAreas([...cache.points.filter((t) => t.airport).map((t) => ({ code: t.airport!, polygon: t.polygon })),
    ...cache.nogoSpots.filter((n) => n.airport).flatMap((n) => zoneAirportAreas(n.airport!, n.polygon, [...n.points, ...n.dropPoints]))]);
}
/** No-go zones that have pickup / drop-off points next to them (2026-11-26). */
export async function noGoSpots(now = Date.now()): Promise<NoGoSpots[]> {
  await load(now);
  return cache!.nogoSpots;
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
  return nearestOf(p, 'points');
}

/** Inside a no-go zone that has points of that kind next to it → the nearest of them (2026-11-26). */
async function nearestOf<T extends { lat: number; lng: number; label?: string }>(p: T, key: 'points' | 'dropPoints'): Promise<T> {
  for (const z of await noGoSpots()) {
    const list = z[key];
    if (!list.length || !inside(p, z.polygon)) continue;
    let best = list[0], bd = Infinity;
    for (const s of list) { const d = (s.lat - p.lat) ** 2 + ((s.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; best = s; } }
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
  return nearestOf(p, 'dropPoints');
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
/** How far from a no-go zone its pickup / drop-off points may be (2026-11-26). */
export const NOGO_SPOT_M = 3000;
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
  .refine((d) => d.kind !== 'POINT' || [...(d.points ?? []), ...(d.dropPoints ?? [])].every((s) => onCyprusIsland(s) && pointInPolygon(s, smoothRing(d.polygon).map(([lat, lng]) => ({ lat, lng })))), { message: 'Pickup and drop-off points must be inside the territory, on land.' })
  // A no-go zone's points are NEXT TO it (2026-11-26): on land, outside the zone, within 3 km of its edge.
  .refine((d) => d.kind !== 'NOGO' || [...(d.points ?? []), ...(d.dropPoints ?? [])].every((s) => onCyprusIsland(s) && !pointInPolygon(s, d.polygon.map(([lat, lng]) => ({ lat, lng }))) && d.polygon.some(([la, ln]) => Math.hypot((la - s.lat) * 110540, (ln - s.lng) * 111320 * Math.cos((s.lat * Math.PI) / 180)) <= NOGO_SPOT_M)), { message: 'The points of a no-go zone must be next to it: outside the zone, on land, within 3 km.' })
  // Pickup and drop-off points do not mix (operator: «чтобы не переплетались»): at least 15 m apart.
  .refine((d) => (d.points ?? []).every((a) => (d.dropPoints ?? []).every((b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)) >= MIN_PICK_DROP_M)), { message: `A drop-off point must be at least ${MIN_PICK_DROP_M} m from every pickup point.` });
export function noGoData(d: z.infer<typeof noGoSchema>) {
  return { name: d.name, kind: d.kind ?? 'NOGO', polygon: d.polygon, points: d.kind === 'POINT' || d.kind === 'NOGO' ? (d.points ?? []) : undefined, dropPoints: d.kind === 'POINT' || d.kind === 'NOGO' ? (d.dropPoints ?? []) : undefined, active: d.active ?? true,
    // Not sent (e.g. the on/off switch) → unchanged; a no-go zone is never an airport.
    // A no-go zone keeps its fixed-prices link (set on the fixed-prices page, 2026-11-26) when its form is saved.
    ...(d.kind === 'POINT' || d.kind === 'STAND' ? (d.airport !== undefined ? { airport: d.airport } : {}) : {}),
    ...(d.kind === 'STAND' ? (d.forZoneId !== undefined ? { forZoneId: d.forZoneId } : {}) : { forZoneId: null }),
    // «Минимальный заказ отсюда» — a territory's, and (2026-11-26) a no-go zone's: from its pickup points next to it.
    ...(d.kind === 'POINT' || d.kind === 'NOGO' ? { ...(d.minComfortCents !== undefined ? { minComfortCents: d.minComfortCents } : {}), ...(d.minXlCents !== undefined ? { minXlCents: d.minXlCents } : {}), ...(d.minActive !== undefined ? { minActive: d.minActive } : {}), ...(d.pointsActive !== undefined ? { pointsActive: d.pointsActive } : {}) } : { minComfortCents: null, minXlCents: null }) };
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
  // A no-go zone's minimum (2026-11-26): the pickup is on one of its pickup points next to it (moved there from inside).
  for (const n of await noGoSpots()) {
    const cents = vClass === 'XL' ? n.minXlCents : n.minComfortCents;
    if (!cents || !n.minActive) continue;
    if (!n.points.some((s) => Math.hypot((s.lat - pickup.lat) * 110540, (s.lng - pickup.lng) * 111320 * Math.cos((pickup.lat * Math.PI) / 180)) <= 30)) continue;
    if (!best || cents > best.cents) best = { cents, zone: n.name };
  }
  return best;
}
