import { apiOk, apiError, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { rateTrip, validateRating } from '@/server/ratings';

export const dynamic = 'force-dynamic';

// GET — the passenger's rating state for their OWN booking: whether it can be rated yet and the
// rating they already left (if any). Drives the "Rate your trip" prompt in My rides.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;

  const booking = await prisma.booking.findFirst({
    where: { id, passengerId: p.id },
    select: { id: true, status: true, rating: { select: { stars: true, tags: true, comment: true, createdAt: true } } },
  });
  if (!booking) return Errors.notFound('Ride not found.');

  const rating = booking.rating
    ? {
        stars: booking.rating.stars,
        tags: booking.rating.tags ? (JSON.parse(booking.rating.tags) as string[]) : [],
        comment: booking.rating.comment,
        createdAt: booking.rating.createdAt,
      }
    : null;

  return apiOk({
    status: booking.status,
    canRate: booking.status === 'COMPLETED' && !rating,
    rating,
  });
}

// POST — submit a rating (1-5 stars + optional tags/comment). One per completed booking.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const b = (body ?? {}) as { stars?: unknown; tags?: unknown; comment?: unknown };

  const parsed = validateRating({ stars: b.stars, tags: b.tags, comment: b.comment });
  if (!parsed.ok) return Errors.validation(parsed.fieldErrors);

  const result = await rateTrip({
    bookingId: id,
    passengerId: p.id,
    stars: parsed.stars,
    tags: parsed.tags,
    comment: parsed.comment,
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);

  return apiOk({ ok: true, stars: result.stars, driver: result.driver });
}
