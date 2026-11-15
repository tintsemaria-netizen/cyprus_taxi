import { apiOk, apiError, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getTrackingBookingId } from '@/lib/tracking';
import { rateTrip, validateRating } from '@/server/ratings';

export const dynamic = 'force-dynamic';

// Rate the trip straight from the finished-ride screen (2026-11-15). The FULL tracking session
// identifies the ride (never a read-only share link); the rating is recorded for the passenger
// account that owns the booking. Same rules as /passenger/rides/[id]/rating.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const v = validateRating((body ?? {}) as { stars: unknown; tags?: unknown; comment?: unknown });
  if (!v.ok) return Errors.validation(v.fieldErrors);
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { passengerId: true } });
  if (!b?.passengerId) return apiError(409, 'NO_ACCOUNT', 'This ride was booked without an account and cannot be rated.');
  const r = await rateTrip({ bookingId, passengerId: b.passengerId, stars: v.stars, tags: v.tags, comment: v.comment });
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, stars: v.stars });
}
