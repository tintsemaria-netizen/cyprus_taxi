import { prisma } from '@/lib/db';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';
import { eligibleDriverWhere } from '@/lib/eligibility-policy';

// Supply/demand snapshot for a zone/class (Task 012 §6.2/§6.3). Supply = fresh, eligible,
// AVAILABLE drivers of the class within the radius (not "every visible vehicle"). Demand =
// recent still-unserved requests of the class within the radius (not autocomplete traffic).

const DEMAND_WINDOW_MS = 5 * 60 * 1000; // count requests from the last 5 minutes

export interface MarketSnapshot {
  activeRequests: number;
  availableDrivers: number;
  radiusKm: number;
}

export async function marketSnapshot(
  pickup: { lat: number; lng: number },
  vClass: 'COMFORT' | 'XL',
  radiusKm = 7,
): Promise<MarketSnapshot> {
  const radiusM = radiusKm * 1000;

  const [drivers, busyAssign, busyOffer, requests] = await Promise.all([
    prisma.driver.findMany({
      where: { onDuty: true, available: true, active: true, ...eligibleDriverWhere },
      include: { user: true, location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
    }),
    prisma.assignment.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    prisma.driverOffer.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
    prisma.booking.findMany({
      where: { status: 'SEARCHING', vClass, createdAt: { gte: new Date(Date.now() - DEMAND_WINDOW_MS) } },
      select: { pickupLat: true, pickupLng: true },
    }),
  ]);
  const busy = new Set<string>([...busyAssign.map((b) => b.activeDriverId!), ...busyOffer.map((b) => b.activeDriverId!)]);

  let availableDrivers = 0;
  for (const d of drivers) {
    if (!d.user.active || busy.has(d.id)) continue;
    const b = d.bindings[0];
    if (!b || !b.vehicle.active || b.vehicle.vClass !== vClass) continue;
    const loc = d.location;
    if (!loc || computeFreshness(loc.sampledAt, loc.receivedAt) !== 'fresh') continue;
    if (haversineMeters({ lat: loc.lat, lng: loc.lng }, pickup) > radiusM) continue;
    availableDrivers++;
  }

  const activeRequests = requests.filter((r) => haversineMeters({ lat: r.pickupLat, lng: r.pickupLng }, pickup) <= radiusM).length;

  return { activeRequests, availableDrivers, radiusKm };
}
