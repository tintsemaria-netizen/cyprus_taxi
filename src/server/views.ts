import { prisma } from '@/lib/db';
import { computeFreshness, poorAccuracy } from '@/lib/freshness';
import { demoEstimate } from '@/lib/places';
import { allowedNext, PASSENGER_CANCELABLE } from '@/lib/status-machine';
import { googleConfigured, googleRoute } from '@/server/google';
import { BookingStatus } from '@prisma/client';

// Bounded pickup-ETA cache: recompute the real driver→pickup route at most every ~20s
// per booking (Task 012 §5.2), so per-passenger polling doesn't spam the Routes API.
const pickupEtaCache = new Map<string, { etaMin: number; at: number }>();
async function driverToPickupEtaMin(bookingId: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<number | null> {
  const cached = pickupEtaCache.get(bookingId);
  if (cached && Date.now() - cached.at < 20000) return cached.etaMin;
  if (googleConfigured()) {
    try {
      const r = await googleRoute(from, to);
      if (r) { pickupEtaCache.set(bookingId, { etaMin: r.etaMinutes, at: Date.now() }); return r.etaMinutes; }
    } catch { /* fall through to approximate */ }
  }
  return demoEstimate(from, to).etaMinutes; // labelled approximate fallback
}

// ---- Passenger tracking view (scoped, minimal fields) ----
export async function trackingView(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!booking) return null;

  const active = await prisma.assignment.findFirst({ where: { activeBookingId: booking.id } });
  let vehicle = null as null | {
    driverName: string;
    make: string;
    model: string;
    color: string;
    plate: string;
    vClass: string;
    phone: string | null;
  };
  let location = null as null | {
    lat: number;
    lng: number;
    freshness: string;
    poorAccuracy: boolean;
    sampledAt: string;
  };
  let pickupEta: string | null = null;

  if (active) {
    vehicle = {
      driverName: active.driverPublicName,
      make: active.vehicleMake,
      model: active.vehicleModel,
      color: active.vehicleColor,
      plate: active.vehiclePlate,
      vClass: active.vehicleClass,
      phone: active.driverPhone || null,
    };
    const loc = await prisma.latestDriverLocation.findUnique({ where: { driverId: active.driverId } });
    if (loc) {
      const freshness = computeFreshness(loc.sampledAt, loc.receivedAt);
      // Do not expose an active precise position once disconnected.
      if (freshness !== 'disconnected') {
        location = {
          lat: loc.lat,
          lng: loc.lng,
          freshness,
          poorAccuracy: poorAccuracy(loc.accuracyM),
          sampledAt: loc.sampledAt.toISOString(),
        };
        if (booking.status === 'EN_ROUTE' && freshness === 'fresh') {
          // Real driver→pickup road ETA (traffic-aware via Google), not the trip duration.
          const etaMin = await driverToPickupEtaMin(booking.id, { lat: loc.lat, lng: loc.lng }, { lat: booking.pickupLat, lng: booking.pickupLng });
          pickupEta = etaMin != null ? `≈ ${etaMin} min` : 'ETA unavailable';
        }
      }
    }
  }

  return {
    reference: booking.reference,
    status: booking.status,
    revision: booking.revision,
    scheduledAt: booking.scheduledAt?.toISOString() ?? null,
    pickup: { lat: booking.pickupLat, lng: booking.pickupLng, label: booking.pickupLabel },
    dropoff: { lat: booking.dropoffLat, lng: booking.dropoffLng, label: booking.dropoffLabel },
    passengerName: booking.passengerName,
    vClass: booking.vClass,
    passengerCount: booking.passengerCount,
    fareWording: 'Fare confirmed by dispatcher',
    vehicle,
    location,
    pickupEta: pickupEta ?? (booking.status === 'EN_ROUTE' ? 'ETA unavailable' : null),
    fareCents: booking.fareCents ?? null,
    canCancel: PASSENGER_CANCELABLE.includes(booking.status),
    canRetry: booking.status === 'NO_DRIVER',
    timeline: booking.events.map((e) => ({ type: e.type, at: e.createdAt.toISOString(), status: e.afterStatus })),
  };
}

// ---- Driver current-trip view ----
export async function driverCurrentTrip(driverId: string) {
  const active = await prisma.assignment.findFirst({
    where: { activeDriverId: driverId },
    include: { booking: true },
  });
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!active) {
    return { onDuty: driver?.onDuty ?? false, available: driver?.available ?? false, trip: null };
  }
  const b = active.booking;
  return {
    onDuty: driver?.onDuty ?? false,
    available: driver?.available ?? false,
    trip: {
      bookingId: b.id,
      reference: b.reference,
      status: b.status,
      revision: b.revision,
      pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
      dropoff: { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel },
      passengerName: b.passengerName,
      passengerPhone: b.phone, // driver may contact passenger
      note: b.note,
      passengerCount: b.passengerCount,
      vClass: b.vClass,
      allowedNext: allowedNext(b.status as BookingStatus, 'DRIVER'),
    },
  };
}

// ---- Dispatch queue ----
export interface QueueFilters {
  status?: BookingStatus;
  vClass?: 'COMFORT' | 'XL';
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function dispatchQueue(f: QueueFilters) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const where: Record<string, unknown> = {};
  if (f.status) where.status = f.status;
  if (f.vClass) where.vClass = f.vClass;
  if (f.q) {
    where.OR = [
      { reference: { contains: f.q, mode: 'insensitive' } },
      { phone: { contains: f.q } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      // Immediate requests (null scheduledAt) first, newest first; then scheduled
      // requests ordered by pickup time ascending. Explicit NULL handling.
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { assignments: { where: { activeBookingId: { not: null } }, take: 1 } },
    }),
    prisma.booking.count({ where }),
  ]);
  return {
    page,
    pageSize,
    total,
    bookings: rows.map((b) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      revision: b.revision,
      vClass: b.vClass,
      passengerCount: b.passengerCount,
      pickupLabel: b.pickupLabel,
      dropoffLabel: b.dropoffLabel,
      scheduledAt: b.scheduledAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      assignedDriver: b.assignments[0]?.driverPublicName ?? null,
      dueSoon: b.scheduledAt ? b.scheduledAt.getTime() - Date.now() < 30 * 60 * 1000 : false,
    })),
  };
}

export async function dispatchDetail(id: string) {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      assignments: { orderBy: { assignedAt: 'desc' } },
    },
  });
  if (!b) return null;
  const active = b.assignments.find((a) => a.activeBookingId);
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    revision: b.revision,
    pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
    dropoff: { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel },
    passengerName: b.passengerName,
    phone: b.phone,
    note: b.note,
    vClass: b.vClass,
    passengerCount: b.passengerCount,
    scheduledAt: b.scheduledAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    allowedNext: allowedNext(b.status as BookingStatus, 'STAFF'),
    activeAssignment: active
      ? { driverName: active.driverPublicName, plate: active.vehiclePlate, make: active.vehicleMake, model: active.vehicleModel, color: active.vehicleColor }
      : null,
    timeline: b.events.map((e) => ({
      type: e.type,
      at: e.createdAt.toISOString(),
      before: e.beforeStatus,
      after: e.afterStatus,
      actorType: e.actorType,
      reason: e.reason,
    })),
  };
}

// ---- Available drivers for the assignment dialog ----
export async function availableDrivers() {
  const busy = await prisma.assignment.findMany({
    where: { activeDriverId: { not: null } },
    select: { activeDriverId: true },
  });
  const busyIds = new Set(busy.map((b) => b.activeDriverId));
  const drivers = await prisma.driver.findMany({
    where: { active: true, onDuty: true, available: true },
    include: { user: true, location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
  });
  return drivers
    .filter((d) => d.user.active && !busyIds.has(d.id))
    .map((d) => {
      const binding = d.bindings[0];
      const loc = d.location;
      const freshness = loc ? computeFreshness(loc.sampledAt, loc.receivedAt) : 'disconnected';
      return {
        driverId: d.id,
        name: d.publicName,
        vehicle: binding
          ? { vehicleId: binding.vehicle.id, plate: binding.vehicle.plate, vClass: binding.vehicle.vClass, seats: binding.vehicle.seats, label: `${binding.vehicle.make} ${binding.vehicle.model}` }
          : null,
        gpsFreshness: freshness,
      };
    });
}

// ---- Fleet map (on-duty latest positions) ----
// Passenger-facing "cars nearby" feed. ANONYMIZED: only position + freshness — no
// driver id/name/plate and no booking, so it never reveals driver identity or which
// trip a car is on. On-duty active drivers with a non-disconnected fix only.
export async function publicFleet() {
  const [drivers, busy] = await Promise.all([
    prisma.driver.findMany({ where: { onDuty: true, active: true }, include: { location: true, user: true } }),
    prisma.assignment.findMany({ where: { activeDriverId: { not: null } }, select: { activeDriverId: true } }),
  ]);
  const busyIds = new Set(busy.map((b) => b.activeDriverId));
  const now = new Date();
  const out: { lat: number; lng: number; stale: boolean; state: 'available' | 'busy' }[] = [];
  for (const d of drivers) {
    if (!d.user.active) continue; // validate staff account, not only Driver.active
    const loc = d.location;
    if (!loc) continue;
    const f = computeFreshness(loc.sampledAt, loc.receivedAt, now);
    if (f === 'disconnected') continue; // don't show cars whose fix has gone stale
    // Busy drivers are visible but a different state; available = on-duty, no active trip.
    const state = busyIds.has(d.id) || !d.available ? 'busy' : 'available';
    out.push({ lat: loc.lat, lng: loc.lng, stale: f === 'stale', state });
  }
  return out;
}

export async function fleet() {
  const drivers = await prisma.driver.findMany({
    where: { onDuty: true, active: true },
    include: { location: true, assignments: { where: { activeDriverId: { not: null } }, take: 1, include: { booking: true } } },
  });
  return drivers
    .map((d) => {
      const loc = d.location;
      if (!loc) return null;
      const freshness = computeFreshness(loc.sampledAt, loc.receivedAt);
      return {
        driverId: d.id,
        name: d.publicName,
        lat: loc.lat,
        lng: loc.lng,
        freshness,
        poorAccuracy: poorAccuracy(loc.accuracyM),
        booking: d.assignments[0]?.booking
          ? { reference: d.assignments[0].booking.reference, status: d.assignments[0].booking.status }
          : null,
      };
    })
    .filter(Boolean);
}
