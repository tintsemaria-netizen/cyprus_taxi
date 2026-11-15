import { prisma } from '@/lib/db';

// Passenger live location for the driver (2026-11-15).
// Strictly opt-in: the passenger switches it on from the tracking screen for this ride (the person
// who booked may be ordering for somebody else, so it is never automatic). Stored only while the
// driver is on the way / waiting, shown to the driver only when fresh, and wiped by the worker
// as soon as the ride is picked up or ends, or the last update is older than PURGE_AFTER_MS.

export const PRE_PICKUP = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'] as const;
// The passenger app sends every 2 s while open; a position older than 8 s means the app was
// closed or hidden → the driver's marker disappears (2026-11-15).
export const SHOW_MAX_AGE_MS = 8_000;
/** The driver sees the passenger only when at the pickup (ARRIVED) or within this distance of it. */
export const SHOW_NEAR_PICKUP_M = 300;
export const PURGE_AFTER_MS = 5 * 60_000;

const CLEAR = { passengerLat: null, passengerLng: null, passengerLocAccuracyM: null, passengerLocAt: null };

export async function savePassengerLocation(bookingId: string, loc: { lat: number; lng: number; accuracyM: number }, now = new Date()): Promise<'ok' | 'not_active'> {
  const r = await prisma.booking.updateMany({
    where: { id: bookingId, status: { in: [...PRE_PICKUP] } },
    data: { passengerLat: loc.lat, passengerLng: loc.lng, passengerLocAccuracyM: loc.accuracyM, passengerLocAt: now },
  });
  return r.count ? 'ok' : 'not_active';
}

export async function clearPassengerLocation(bookingId: string): Promise<void> {
  await prisma.booking.updateMany({ where: { id: bookingId }, data: CLEAR });
}

/** What the driver may see: only before pickup and only a fresh fix. */
export function passengerLocationForDriver(
  b: { status: string; passengerLat: number | null; passengerLng: number | null; passengerLocAccuracyM: number | null; passengerLocAt: Date | null; pickupLat?: number; pickupLng?: number },
  now = new Date(),
  driverPos?: { lat: number; lng: number } | null,
): { lat: number; lng: number; accuracyM: number; ageSec: number } | null {
  if (!(PRE_PICKUP as readonly string[]).includes(b.status)) return null;
  // Only once the driver has reached the pickup area — that's where they need to find the person.
  if (b.status !== 'ARRIVED') {
    if (!driverPos || b.pickupLat == null || b.pickupLng == null) return null;
    if (haversineM(driverPos, { lat: b.pickupLat, lng: b.pickupLng }) > SHOW_NEAR_PICKUP_M) return null;
  }
  if (b.passengerLat == null || b.passengerLng == null || !b.passengerLocAt) return null;
  const age = now.getTime() - b.passengerLocAt.getTime();
  if (age > SHOW_MAX_AGE_MS) return null;
  return { lat: b.passengerLat, lng: b.passengerLng, accuracyM: Math.round(b.passengerLocAccuracyM ?? 0), ageSec: Math.max(0, Math.round(age / 1000)) };
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Worker: forget every passenger position that is no longer needed. */
export async function purgePassengerLocations(now = new Date()): Promise<number> {
  const r = await prisma.booking.updateMany({
    where: {
      passengerLocAt: { not: null },
      OR: [{ status: { notIn: [...PRE_PICKUP] } }, { passengerLocAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } }],
    },
    data: CLEAR,
  });
  return r.count;
}
