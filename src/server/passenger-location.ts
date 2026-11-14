import { prisma } from '@/lib/db';

// Passenger live location for the driver (2026-11-15).
// Strictly opt-in: the passenger switches it on from the tracking screen for this ride (the person
// who booked may be ordering for somebody else, so it is never automatic). Stored only while the
// driver is on the way / waiting, shown to the driver only when fresh, and wiped by the worker
// as soon as the ride is picked up or ends, or the last update is older than PURGE_AFTER_MS.

export const PRE_PICKUP = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'] as const;
export const SHOW_MAX_AGE_MS = 60_000;
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
  b: { status: string; passengerLat: number | null; passengerLng: number | null; passengerLocAccuracyM: number | null; passengerLocAt: Date | null },
  now = new Date(),
): { lat: number; lng: number; accuracyM: number; ageSec: number } | null {
  if (!(PRE_PICKUP as readonly string[]).includes(b.status)) return null;
  if (b.passengerLat == null || b.passengerLng == null || !b.passengerLocAt) return null;
  const age = now.getTime() - b.passengerLocAt.getTime();
  if (age > SHOW_MAX_AGE_MS) return null;
  return { lat: b.passengerLat, lng: b.passengerLng, accuracyM: Math.round(b.passengerLocAccuracyM ?? 0), ageSec: Math.max(0, Math.round(age / 1000)) };
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
