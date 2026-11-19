import { haversineMeters, type LatLng } from '@/lib/geo';
import { airportAt } from '@/lib/airports';

// Ride-share «Попутчик» (Task 022) — pure helpers: which trips qualify, the shared price, and the
// best order of pickups/drop-offs for two bookings in one car. No I/O here: the caller supplies a
// leg-time function (road-routed when Google is configured, otherwise approxLegMin).

// Where ride-share is offered (operator, 2026-11-19): the two airports and the towns of Larnaca,
// Nicosia, Paphos and Ayia Napa. A trip qualifies when it goes from one of these places to ANOTHER
// one (e.g. Larnaca airport → Larnaca town, Paphos airport → Paphos, Larnaca → Nicosia); never
// inside one town. Limassol is not in the list yet. Town areas are a centre + radius for now.
export const SHARE_TOWNS = [
  { key: 'LARNACA', lat: 34.9167, lng: 33.629, radiusM: 7000 },
  { key: 'NICOSIA', lat: 35.17, lng: 33.36, radiusM: 11000 },
  { key: 'PAPHOS', lat: 34.776, lng: 32.424, radiusM: 8000 },
  { key: 'AYIA_NAPA', lat: 34.988, lng: 33.999, radiusM: 6000 },
  // Limassol added 2026-11-19 (operator): Germasogeia / Agios Tychonas to Ypsonas / Polemidia.
  { key: 'LIMASSOL', lat: 34.69, lng: 33.04, radiusM: 10000 },
] as const;

/** The ride-share place of a point: an airport code (checked first) or a town key; null elsewhere. */
export function shareZone(p: LatLng): string | null {
  const ap = airportAt(p.lat, p.lng);
  if (ap) return ap;
  return SHARE_TOWNS.find((t) => haversineMeters(p, t) <= t.radiusM)?.key ?? null;
}

/** Ride-share is offered between two DIFFERENT places of the list above. */
export function isShareRoute(pickup: LatLng, dropoff: LatLng): boolean {
  const a = shareZone(pickup);
  const b = shareZone(dropoff);
  return !!a && !!b && a !== b;
}

/** The co-rider price: full price minus the discount, rounded to 10 cents. */
export function sharedCents(fullCents: number, discountPct: number): number {
  return Math.round((fullCents * (100 - discountPct)) / 100 / 10) * 10;
}

/** Straight-line driving estimate in minutes (road ≈ 1.3× crow-flies; slower in town). */
export function approxLegMin(a: LatLng, b: LatLng): number {
  const km = (haversineMeters(a, b) / 1000) * 1.3;
  const kmh = km < 8 ? 30 : km < 25 ? 50 : 70;
  return km < 0.05 ? 0 : Math.max(1, Math.round((km / kmh) * 60));
}

export type StopKey = 'Hp' | 'Hd' | 'Gp' | 'Gd';
export type Stop = { kind: 'pickup' | 'dropoff'; who: 'host' | 'guest' };
export const STOP_OF: Record<StopKey, Stop> = {
  Hp: { kind: 'pickup', who: 'host' }, Hd: { kind: 'dropoff', who: 'host' },
  Gp: { kind: 'pickup', who: 'guest' }, Gd: { kind: 'dropoff', who: 'guest' },
};

export interface SharePoints { start: LatLng; Hp: LatLng; Hd: LatLng; Gp: LatLng; Gd: LatLng }
export type LegFn = (a: LatLng, b: LatLng) => number;

export interface SharePlan {
  order: StopKey[]; // remaining stops after `start`
  extraHost: number; // minutes the host arrives later than without the co-rider
  extraGuest: number; // guest's time on board minus a direct ride
  extraDriver: number; // driver's whole remaining trip, longer by
  totalMin: number;
  // Minutes from the plan's start: each passenger's final drop-off and the end of the trip, so
  // everyone sees WHEN they arrive (a co-rider dropped off first can delay the other).
  arrive: { host: number; guest: number; end: number; guestPickup: number };
}

// Orders where both passengers are in the car together at some point (otherwise it's not sharing).
const ORDERS_HOST_WAITING: StopKey[][] = [
  ['Hp', 'Gp', 'Hd', 'Gd'], ['Hp', 'Gp', 'Gd', 'Hd'], ['Gp', 'Hp', 'Hd', 'Gd'], ['Gp', 'Hp', 'Gd', 'Hd'],
];
const ORDERS_HOST_ON_BOARD: StopKey[][] = [['Gp', 'Hd', 'Gd'], ['Gp', 'Gd', 'Hd']];

function arrivals(start: LatLng, order: StopKey[], pts: SharePoints, leg: LegFn): Record<string, number> {
  const at: Record<string, number> = {};
  let t = 0;
  let cur = start;
  for (const k of order) { t += leg(cur, pts[k]); at[k] = t; cur = pts[k]; }
  at.total = t;
  return at;
}

/**
 * Best plan to add a guest to a host's trip. `hostOnBoard`: the host is already in the car (only
 * Hd remains for them). Plans over either passenger's limit are rejected; null = no fit.
 */
export function bestSharePlan(
  pts: SharePoints,
  leg: LegFn,
  opts: { hostOnBoard: boolean; hostMaxExtra: number; guestMaxExtra: number },
): SharePlan | null {
  const base = opts.hostOnBoard ? arrivals(pts.start, ['Hd'], pts, leg) : arrivals(pts.start, ['Hp', 'Hd'], pts, leg);
  const direct = leg(pts.Gp, pts.Gd);
  let best: SharePlan | null = null;
  for (const order of opts.hostOnBoard ? ORDERS_HOST_ON_BOARD : ORDERS_HOST_WAITING) {
    const at = arrivals(pts.start, order, pts, leg);
    const extraHost = Math.max(0, Math.round(at.Hd - base.Hd));
    const extraGuest = Math.max(0, Math.round(at.Gd - at.Gp - direct));
    if (extraHost > opts.hostMaxExtra || extraGuest > opts.guestMaxExtra) continue;
    const plan: SharePlan = {
      order, extraHost, extraGuest, extraDriver: Math.max(0, Math.round(at.total - base.total)), totalMin: Math.round(at.total),
      arrive: { host: Math.round(at.Hd), guest: Math.round(at.Gd), end: Math.round(at.total), guestPickup: Math.round(at.Gp) },
    };
    if (!best || extraHost + extraGuest < best.extraHost + best.extraGuest) best = plan;
  }
  return best;
}

/** Two pre-bookings: start at the host's pickup (the earlier one). */
export function bestPrebookPlan(pts: Omit<SharePoints, 'start'>, leg: LegFn, opts: { hostMaxExtra: number; guestMaxExtra: number }): SharePlan | null {
  const directHost = leg(pts.Hp, pts.Hd);
  const directGuest = leg(pts.Gp, pts.Gd);
  let best: SharePlan | null = null;
  // The host is picked up first (they are the earlier pickup); either drop-off order.
  for (const order of [['Gp', 'Hd', 'Gd'], ['Gp', 'Gd', 'Hd']] as StopKey[][]) {
    const at = arrivals(pts.Hp, order, { ...pts, start: pts.Hp }, leg);
    const extraHost = Math.max(0, Math.round(at.Hd - directHost));
    const extraGuest = Math.max(0, Math.round(at.Gd - at.Gp - directGuest));
    if (extraHost > opts.hostMaxExtra || extraGuest > opts.guestMaxExtra) continue;
    const plan: SharePlan = {
      order: ['Hp', ...order], extraHost, extraGuest, extraDriver: Math.max(0, Math.round(at.total - directHost)), totalMin: Math.round(at.total),
      arrive: { host: Math.round(at.Hd), guest: Math.round(at.Gd), end: Math.round(at.total), guestPickup: Math.round(at.Gp) },
    };
    if (!best || extraHost + extraGuest < best.extraHost + best.extraGuest) best = plan;
  }
  return best;
}

/** Seats and boot space for both bookings together. */
export function shareFits(
  host: { passengerCount: number; luggageCount: number },
  guest: { passengerCount: number; luggageCount: number },
  seats: number,
  luggageCap: number,
): boolean {
  return host.passengerCount + guest.passengerCount <= seats && host.luggageCount + guest.luggageCount <= luggageCap;
}

/**
 * Pre-booked pair timing: the car leaves the host's (earlier) pickup at `startAt`, never before the
 * co-rider can be there; each passenger waits at most the time they said they can wait.
 * Returns null when the waits do not fit.
 */
export function prebookTiming(
  hostAt: Date, guestAt: Date, legHpGpMin: number, hostWaitMin: number, guestWaitMin: number,
): { startAt: Date; hostWait: number; guestWait: number; guestPickupAt: Date } | null {
  const MIN = 60_000;
  const start = Math.max(hostAt.getTime(), guestAt.getTime() - legHpGpMin * MIN);
  const hostWait = Math.round((start - hostAt.getTime()) / MIN);
  const guestPickup = start + legHpGpMin * MIN;
  const guestWait = Math.round((guestPickup - guestAt.getTime()) / MIN);
  if (hostWait > hostWaitMin || guestWait > guestWaitMin || guestWait < 0) return null;
  return { startAt: new Date(start), hostWait, guestWait, guestPickupAt: new Date(guestPickup) };
}
