import { prisma } from '@/lib/db';

/** Average rating drivers gave a passenger — staff lists and, since 2026-11-26, the driver's offer / free-order /
 *  pre-booking cards next to the client's name (one shared function). */
export async function passengerRatingSummary(passengerIds: string[]) {
  const ids = [...new Set(passengerIds.filter(Boolean))];
  if (!ids.length) return new Map<string, { average: number; count: number }>();
  const rows = await prisma.passengerRating.groupBy({ by: ['passengerId'], where: { passengerId: { in: ids } }, _avg: { stars: true }, _count: { _all: true } });
  return new Map(rows.filter((r) => r.passengerId).map((r) => [r.passengerId!, { average: Math.round((r._avg.stars ?? 0) * 10) / 10, count: r._count._all }]));
}

/** One passenger's rating, or null (no passenger account / never rated). */
export async function passengerRatingOf(passengerId: string | null | undefined) {
  if (!passengerId) return null;
  return (await passengerRatingSummary([passengerId])).get(passengerId) ?? null;
}
