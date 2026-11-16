import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

// Blocked driver–passenger pairs (2026-11-17, owner's rule): once either side has rated the
// other with ONE star — the driver rated the passenger (PassengerRating) or the passenger rated
// the driver (TripRating) — the two are never matched again: no offer, no free order, no
// pre-booking. Checked before ranking AND re-checked inside every acceptance transaction.
// Bookings without a passenger account (guest) have no identity to block on.
export const BLOCK_STARS = 1;

type Db = Prisma.TransactionClient | typeof prisma;

/** Drivers who must never get this passenger's rides. */
export async function blockedDriverIdsForPassenger(passengerId: string | null | undefined, db: Db = prisma): Promise<Set<string>> {
  if (!passengerId) return new Set();
  const [byPax, byDriver] = await Promise.all([
    db.tripRating.findMany({ where: { passengerId, stars: { lte: BLOCK_STARS } }, select: { driverId: true } }),
    db.passengerRating.findMany({ where: { passengerId, stars: { lte: BLOCK_STARS } }, select: { driverId: true } }),
  ]);
  return new Set([...byPax.map((r) => r.driverId), ...byDriver.map((r) => r.driverId)]);
}

/** Passengers whose rides this driver must never get. */
export async function blockedPassengerIdsForDriver(driverId: string, db: Db = prisma): Promise<Set<string>> {
  const [byPax, byDriver] = await Promise.all([
    db.tripRating.findMany({ where: { driverId, stars: { lte: BLOCK_STARS } }, select: { passengerId: true } }),
    db.passengerRating.findMany({ where: { driverId, stars: { lte: BLOCK_STARS }, passengerId: { not: null } }, select: { passengerId: true } }),
  ]);
  return new Set([...byPax.map((r) => r.passengerId), ...byDriver.map((r) => r.passengerId!)]);
}

export async function isPairBlocked(driverId: string, passengerId: string | null | undefined, db: Db = prisma): Promise<boolean> {
  if (!passengerId) return false;
  const [a, b] = await Promise.all([
    db.tripRating.count({ where: { driverId, passengerId, stars: { lte: BLOCK_STARS } } }),
    db.passengerRating.count({ where: { driverId, passengerId, stars: { lte: BLOCK_STARS } } }),
  ]);
  return a + b > 0;
}
