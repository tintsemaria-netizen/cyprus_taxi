import { prisma } from '@/lib/db';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';
import { googleConfigured, googleRoute } from '@/server/google';
import { eligibleDriverWhere } from '@/lib/eligibility-policy';

export const RADIUS_STAGES_KM = [3, 7, 15]; // expand search in stages (Task 012 §4.2)
export const MAX_PICKUP_ETA_SEC = 20 * 60; // exclude candidates worse than 20 min
export const SHORTLIST = 5; // how many nearest to road-route per cycle
export const DISPATCH_ROUTE_TIMEOUT_MS = 2500; // per Routes call while matching (falls back to approx)
const ETA_TIE_SEC = 60; // candidates within 60s of best ETA tie-break on idle

export interface Candidate {
  driverId: string;
  vehicleId: string;
  distanceMeters: number;
  etaSec: number;
  etaApproximate: boolean;
}

// Find the single best candidate for a booking under the given radius, EXCLUDING the
// drivers already tried. Screens spatially first, then ranks a bounded shortlist by real
// Google driving ETA. Returns null if none eligible within the radius.
export async function findBestCandidate(
  booking: { pickupLat: number; pickupLng: number; vClass: 'COMFORT' | 'XL'; passengerCount: number },
  radiusKm: number,
  triedDriverIds: string[],
  etaCache: Map<string, { etaSec: number; approx: boolean }> = new Map(),
): Promise<Candidate | null> {
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };

  // Drivers already reserved by an active assignment or active offer are unavailable.
  const [busyAssign, busyOffer, drivers] = await Promise.all([
    prisma.assignment.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    prisma.driverOffer.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    prisma.driver.findMany({
      where: { onDuty: true, available: true, active: true, ...eligibleDriverWhere },
      include: { user: true, location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
    }),
  ]);
  const busy = new Set<string>([...busyAssign.map((b) => b.activeDriverId!), ...busyOffer.map((b) => b.activeDriverId!)]);
  const tried = new Set(triedDriverIds);

  // Spatial + hard-eligibility prefilter.
  const prelim: { driverId: string; vehicleId: string; distanceMeters: number }[] = [];
  for (const d of drivers) {
    if (!d.user.active || busy.has(d.id) || tried.has(d.id)) continue;
    const binding = d.bindings[0];
    if (!binding || !binding.vehicle.active) continue;
    const v = binding.vehicle;
    if (v.vClass !== booking.vClass) continue;
    if (v.seats < booking.passengerCount) continue;
    const loc = d.location;
    if (!loc) continue;
    if (computeFreshness(loc.sampledAt, loc.receivedAt) !== 'fresh') continue; // usable GPS only
    const distanceMeters = haversineMeters({ lat: loc.lat, lng: loc.lng }, pickup);
    if (distanceMeters > radiusKm * 1000) continue;
    prelim.push({ driverId: d.id, vehicleId: v.id, distanceMeters });
  }
  if (!prelim.length) return null;

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
    let res: { etaSec: number; approx: boolean };
    if (googleConfigured()) {
      try {
        const r = await googleRoute(from, pickup, undefined, { timeoutMs: DISPATCH_ROUTE_TIMEOUT_MS });
        res = r ? { etaSec: r.etaMinutes * 60, approx: false } : { etaSec: approxEta(c.distanceMeters), approx: true };
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
    const { etaSec, approx } = etas[i];
    if (etaSec <= MAX_PICKUP_ETA_SEC) scored.push({ driverId: c.driverId, vehicleId: c.vehicleId, distanceMeters: c.distanceMeters, etaSec, etaApproximate: approx });
  });
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
