import { prisma } from '@/lib/db';
import { carTakes } from '@/lib/vehicle-class';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';
import { googleConfigured, googleRoute } from '@/server/google';
import { eligibleDriverWhere } from '@/lib/eligibility-policy';
import { prebookHolds, fitsBeforePrebook } from './preassign-core';
import { blockedDriverIdsForPassenger } from './blocked-pairs';
import { taxiStands } from '@/server/no-go';
import { inStand, standsForPickup, standQueueOrder, STAND_LEAVE_MS } from '@/server/stands';

export const RADIUS_STAGES_KM = [3, 7, 15]; // expand search in stages (Task 012 §4.2)
export const MAX_PICKUP_ETA_SEC = 20 * 60; // exclude candidates worse than 20 min
export const SHORTLIST = 5; // how many nearest to road-route per cycle
export const DISPATCH_ROUTE_TIMEOUT_MS = 2500; // per Routes call while matching (falls back to approx)
const ETA_TIE_SEC = 60; // candidates within 60s of best ETA tie-break on idle
// Next order for a driver finishing a trip (2026-11-25, operator): offered when he drops his passenger off within
// 5 min — 7 min when the new pickup is within 1 km of that drop-off. His time to the new client counts the rest
// of the trip + DROP_OFF_SEC + the drive from the drop-off, and competes with free drivers on equal terms.
export const NEXT_ORDER_FINISH_MIN = 5;
export const NEXT_ORDER_FINISH_NEAR_MIN = 7;
export const NEXT_ORDER_NEAR_M = 1000;
const DROP_OFF_SEC = 120; // as preassign.reachMinutes (the passenger sees the same minutes)

export interface Candidate {
  driverId: string;
  vehicleId: string;
  distanceMeters: number;
  roadDistanceMeters?: number; // driving distance to the pickup when road-routed (shown to the driver)
  etaSec: number;
  etaApproximate: boolean;
  /** Offered to a driver still on a trip: the ride becomes his next one (seconds until he drops his passenger). */
  afterTrip?: { finishInSec: number };
  /** Taken from a stand's queue (src/server/stands.ts). */
  fromStand?: boolean;
}

// Find the single best candidate for a booking under the given radius, EXCLUDING the
// drivers already tried. Screens spatially first, then ranks a bounded shortlist by real
// Google driving ETA. Returns null if none eligible within the radius.
export async function findBestCandidate(
  // requireAcceptsShared: a pre-booked ride-share pair is offered only to drivers who take co-riders
  // (passengerCount is then both bookings together).
  booking: { pickupLat: number; pickupLng: number; dropoffLat?: number; dropoffLng?: number; vClass: 'COMFORT' | 'XL'; passengerCount: number; passengerId?: string | null; requireAcceptsShared?: boolean; scheduledAt?: Date | null },
  radiusKm: number,
  triedDriverIds: string[],
  etaCache: Map<string, { etaSec: number; approx: boolean; roadM?: number }> = new Map(),
): Promise<Candidate | null> {
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };

  // Drivers already reserved by an active assignment or active offer are unavailable.
  const [busyAssign, busyOffer, protectedIds, blockedIds, drivers] = await Promise.all([
    prisma.assignment.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    prisma.driverOffer.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    // A driver with a pre-booked ride within the hour gets only a ride towards its pickup that still makes it.
    prebookHolds(),
    // A 1-star rating either way blocks the pair for good (blocked-pairs.ts).
    blockedDriverIdsForPassenger(booking.passengerId),
    prisma.driver.findMany({
      where: { onDuty: true, available: true, active: true, ...eligibleDriverWhere },
      include: { user: true, location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
    }),
  ]);
  const busy = new Set<string>([...busyAssign.map((b) => b.activeDriverId!), ...busyOffer.map((b) => b.activeDriverId!)]);
  const now = new Date();
  const dropoff = booking.dropoffLat != null && booking.dropoffLng != null ? { lat: booking.dropoffLat, lng: booking.dropoffLng } : null;
  const holdOk = (driverId: string, from: { lat: number; lng: number }, approachMin?: number) => {
    const h = protectedIds.get(driverId);
    return !h || (!!dropoff && fitsBeforePrebook(h, now, from, { pickup, dropoff }, approachMin));
  };
  const tried = new Set(triedDriverIds);
  // «Стоянка с очередью» (2026-11-25): drivers standing in a switched-off stand get no orders.
  const stands = await taxiStands();
  const offStands = stands.filter((s) => !s.active);
  // Hard eligibility (everything but the distance): the vehicle this driver would come with, or null.
  const usable = (d: (typeof drivers)[number]) => {
    if (!d.user.active || busy.has(d.id) || tried.has(d.id) || blockedIds.has(d.id)) return null;
    if (booking.requireAcceptsShared && !d.acceptsShared) return null;
    const binding = d.bindings[0];
    if (!binding || !binding.vehicle.active) return null;
    const v = binding.vehicle;
    if (!carTakes(v.vClass, d.takesComfort, booking.vClass, d.takesXl)) return null; // an XL car takes Comfort too (unless switched off)
    if (v.seats < booking.passengerCount) return null;
    const loc = d.location;
    if (!loc) return null;
    if (computeFreshness(loc.sampledAt, loc.receivedAt) !== 'fresh') return null; // usable GPS only
    if (offStands.some((s) => inStand(loc, s))) return null;
    return v;
  };

  // An order from an airport with a switched-on stand goes to its queue first, in order (2026-11-25, operator):
  // the first one there who can take it. A driver who refused / missed it is in `tried` — the next one gets it,
  // and he stays first for the next order. Nobody there → the usual search below.
  const queueStands = await standsForPickup(pickup);
  if (queueStands.length) {
    for (const e of await standQueueOrder(queueStands.map((s) => s.id))) {
      const d = drivers.find((x) => x.id === e.driverId);
      const v = d ? usable(d) : null;
      if (!d || !v) continue;
      const loc = d.location!, stand = queueStands.find((s) => s.id === e.standId)!;
      if (!inStand(loc, stand) && now.getTime() - e.lastInAt.getTime() > STAND_LEAVE_MS) continue; // left the stand
      const from = { lat: loc.lat, lng: loc.lng };
      const leg = await legSec(from, pickup);
      if (!holdOk(d.id, from, leg.sec / 60)) continue;
      return { driverId: d.id, vehicleId: v.id, distanceMeters: haversineMeters(from, pickup), ...(leg.m != null ? { roadDistanceMeters: leg.m } : {}), etaSec: leg.sec, etaApproximate: leg.approx, fromStand: true };
    }
  }

  // Spatial + hard-eligibility prefilter.
  const prelim: { driverId: string; vehicleId: string; distanceMeters: number }[] = [];
  for (const d of drivers) {
    const v = usable(d);
    if (!v) continue;
    const loc = d.location!;
    const distanceMeters = haversineMeters({ lat: loc.lat, lng: loc.lng }, pickup);
    if (distanceMeters > radiusKm * 1000) continue;
    if (!holdOk(d.id, { lat: loc.lat, lng: loc.lng })) continue;
    prelim.push({ driverId: d.id, vehicleId: v.id, distanceMeters });
  }
  // Drivers finishing a trip near this pickup (not for a ride-share pair or a pre-booked ride ahead of time).
  const finishing = booking.requireAcceptsShared || booking.scheduledAt ? [] : await finishingCandidates(pickup, radiusKm, {
    tried, blockedIds, offerBusy: new Set(busyOffer.map((b) => b.activeDriverId!)), vClass: booking.vClass, passengerCount: booking.passengerCount,
    holdOk: (id, from, min) => holdOk(id, from, min),
  });
  if (!prelim.length && !finishing.length) return null;

  // Road-route the nearest few (straight-line distance is only a prefilter).
  prelim.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const shortlist = prelim.slice(0, SHORTLIST);
  // Routed in PARALLEL with a short per-call timeout: a slow/failing Google Routes falls back to a
  // straight-line estimate in ~2.5s for the whole shortlist instead of 8s per driver in sequence.
  const approxEta = (m: number) => Math.round((m / 1000 / 40) * 3600);
  const etas = await Promise.all(shortlist.map(async (c) => {
    const cached = etaCache.get(c.driverId);
    if (cached) return cached;
    const d = drivers.find((x) => x.id === c.driverId)!;
    const from = { lat: d.location!.lat, lng: d.location!.lng };
    let res: { etaSec: number; approx: boolean; roadM?: number };
    if (googleConfigured()) {
      try {
        const r = await googleRoute(from, pickup, undefined, { timeoutMs: DISPATCH_ROUTE_TIMEOUT_MS });
        res = r ? { etaSec: r.etaMinutes * 60, approx: false, roadM: Math.round(r.distanceKm * 1000) } : { etaSec: approxEta(c.distanceMeters), approx: true };
      } catch {
        res = { etaSec: approxEta(c.distanceMeters), approx: true };
      }
    } else {
      res = { etaSec: approxEta(c.distanceMeters), approx: true };
    }
    etaCache.set(c.driverId, res);
    return res;
  }));
  const scored: Candidate[] = [];
  shortlist.forEach((c, i) => {
    const { etaSec, approx, roadM } = etas[i];
    const dl = drivers.find((x) => x.id === c.driverId)!.location!;
    if (!holdOk(c.driverId, { lat: dl.lat, lng: dl.lng }, etaSec / 60)) return; // with the real approach time
    if (etaSec <= MAX_PICKUP_ETA_SEC) scored.push({ driverId: c.driverId, vehicleId: c.vehicleId, distanceMeters: c.distanceMeters, ...(roadM != null ? { roadDistanceMeters: roadM } : {}), etaSec, etaApproximate: approx });
  });
  scored.push(...finishing);
  if (!scored.length) return null;

  // Rank primarily by ETA; within a 60s band prefer the longest-idle driver (fairness),
  // approximated by time since their last assignment ended; deterministic final tie-break.
  scored.sort((a, b) => a.etaSec - b.etaSec);
  const best = scored[0];
  const band = scored.filter((c) => c.etaSec - best.etaSec <= ETA_TIE_SEC);
  if (band.length === 1) return best;

  const idle = await lastAssignmentEndedByDriver(band.map((c) => c.driverId));
  band.sort((a, b) => {
    const ia = idle.get(a.driverId) ?? 0; // older/absent => more idle
    const ib = idle.get(b.driverId) ?? 0;
    if (ia !== ib) return ia - ib; // earlier last-ended (or none) first = longest idle
    return a.driverId < b.driverId ? -1 : 1; // deterministic
  });
  return band[0];
}

async function lastAssignmentEndedByDriver(driverIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.assignment.findMany({
    where: { driverId: { in: driverIds }, endedAt: { not: null } },
    orderBy: { endedAt: 'desc' },
    select: { driverId: true, endedAt: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) if (!m.has(r.driverId)) m.set(r.driverId, r.endedAt!.getTime());
  return m;
}

// Road time between two points (Google with traffic when configured, else straight line at 40 km/h).
async function legSec(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<{ sec: number; approx: boolean; m?: number }> {
  const straight = haversineMeters(a, b);
  if (straight < 30) return { sec: 0, approx: false, m: 0 };
  if (googleConfigured()) {
    try {
      const r = await googleRoute(a, b, undefined, { timeoutMs: DISPATCH_ROUTE_TIMEOUT_MS });
      if (r) return { sec: r.etaMinutes * 60, approx: false, m: Math.round(r.distanceKm * 1000) };
    } catch { /* fall back */ }
  }
  return { sec: Math.round((straight / 1000 / 40) * 3600), approx: true };
}

/** Drivers whose passenger is on board and who will drop him off soon enough near this pickup (see
 *  NEXT_ORDER_*). One next order per driver; never during a shared ride. */
async function finishingCandidates(
  pickup: { lat: number; lng: number },
  radiusKm: number,
  f: { tried: Set<string>; blockedIds: Set<string>; offerBusy: Set<string>; vClass: 'COMFORT' | 'XL'; passengerCount: number; holdOk: (id: string, from: { lat: number; lng: number }, min?: number) => boolean },
): Promise<Candidate[]> {
  const rows = await prisma.assignment.findMany({
    where: { activeDriverId: { not: null }, booking: { status: 'IN_PROGRESS' } },
    include: { booking: true, driver: { include: { user: true, location: true } }, vehicle: true },
  });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.driverId);
  const [queued, legs, groups] = await Promise.all([
    prisma.assignment.findMany({ where: { queuedDriverId: { in: ids } }, select: { queuedDriverId: true } }),
    prisma.assignment.groupBy({ by: ['driverId'], where: { driverId: { in: ids }, activeBookingId: { not: null } }, _count: { _all: true } }),
    prisma.shareGroup.findMany({ where: { OR: [{ activeHostBookingId: { in: rows.map((r) => r.bookingId) } }, { activeGuestBookingId: { in: rows.map((r) => r.bookingId) } }] }, select: { activeHostBookingId: true, activeGuestBookingId: true } }),
  ]);
  const hasNext = new Set(queued.map((q) => q.queuedDriverId!));
  const twoLegs = new Set(legs.filter((l) => l._count._all > 1).map((l) => l.driverId));
  const shared = new Set(groups.flatMap((g) => [g.activeHostBookingId, g.activeGuestBookingId]).filter(Boolean) as string[]);
  const now = new Date();
  const out: Candidate[] = [];
  await Promise.all(rows.map(async (r) => {
    const d = r.driver, b = r.booking, v = r.vehicle;
    if (hasNext.has(d.id) || twoLegs.has(d.id) || shared.has(b.id)) return;
    if (!d.active || !d.user.active || !d.onDuty || f.tried.has(d.id) || f.blockedIds.has(d.id) || f.offerBusy.has(d.id)) return;
    if (!v.active || !carTakes(v.vClass, d.takesComfort, f.vClass, d.takesXl) || v.seats < f.passengerCount) return;
    const loc = d.location;
    if (!loc || computeFreshness(loc.sampledAt, loc.receivedAt, now) !== 'fresh') return;
    const drop = { lat: b.dropoffLat, lng: b.dropoffLng };
    const near = haversineMeters(drop, pickup);
    if (near > radiusKm * 1000) return;
    const limitSec = (near <= NEXT_ORDER_NEAR_M ? NEXT_ORDER_FINISH_NEAR_MIN : NEXT_ORDER_FINISH_MIN) * 60;
    // The rest of his trip: via a stop not made yet, then the drop-off. A cheap straight-line check first.
    const path = [{ lat: loc.lat, lng: loc.lng }, ...(b.stopLat != null && b.stopLng != null && !b.stopDepartedAt ? [{ lat: b.stopLat, lng: b.stopLng }] : []), drop];
    let straight = 0;
    for (let i = 1; i < path.length; i++) straight += haversineMeters(path[i - 1], path[i]);
    if ((straight / 1000 / 60) * 3600 > limitSec) return; // even at 60 km/h he would not be done in time
    let rest = 0, approx = false;
    for (let i = 1; i < path.length; i++) { const l = await legSec(path[i - 1], path[i]); rest += l.sec; approx ||= l.approx; }
    if (path.length > 2) rest += 180; // the stop
    if (rest > limitSec) return;
    const toPickup = await legSec(drop, pickup);
    const etaSec = rest + DROP_OFF_SEC + toPickup.sec;
    if (etaSec > MAX_PICKUP_ETA_SEC || !f.holdOk(d.id, drop, etaSec / 60)) return;
    out.push({ driverId: d.id, vehicleId: v.id, distanceMeters: near, ...(toPickup.m != null ? { roadDistanceMeters: toPickup.m } : {}), etaSec, etaApproximate: approx || toPickup.approx, afterTrip: { finishInSec: rest } });
  }));
  return out;
}
