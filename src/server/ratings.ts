import { prisma } from '@/lib/db';
import { recordEvent, driverPseudo } from '@/server/events';

// Post-trip passenger rating of the driver (Task 020).
//
// Rules:
// - Only the OWNING passenger of a COMPLETED booking may rate it.
// - Exactly one rating per booking (enforced by TripRating.bookingId @unique); a second attempt
//   is a 409 conflict, never a silent overwrite — the first rating is the honest record.
// - The rated driver is the one who COMPLETED the trip (the assignment with reason 'completed'),
//   not merely the latest assignee, so a driver reassigned away before pickup is never rated.
// - Creating the rating and incrementing the driver's aggregate (ratingTotal/ratingCount) happen
//   in ONE transaction, so the average is always consistent with the rating rows.

export const RATING_TAGS = [
  // Positive signals (shown for 4-5 stars)
  'clean_car',
  'safe_driving',
  'on_time',
  'friendly',
  'smooth_ride',
  'great_route',
  // Constructive signals (shown for 1-3 stars)
  'late',
  'unsafe_driving',
  'rude',
  'dirty_car',
  'wrong_route',
  'hard_to_find',
] as const;

export type RatingTag = (typeof RATING_TAGS)[number];

export const MAX_COMMENT_LEN = 500;
export const MAX_TAGS = 5;

export interface RateInput {
  bookingId: string;
  passengerId: string;
  stars: number;
  tags?: string[];
  comment?: string | null;
}

export type RateResult =
  | { ok: true; stars: number; driver: { ratingAvg: number; ratingCount: number } }
  | { ok: false; status: number; code: string; message: string };

function err(status: number, code: string, message: string): RateResult {
  return { ok: false, status, code, message };
}

// Validate the raw rating payload. Returns cleaned values or a field-level error map.
export function validateRating(input: {
  stars: unknown;
  tags?: unknown;
  comment?: unknown;
}): { ok: true; stars: number; tags: string[]; comment: string | null } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};

  const stars = typeof input.stars === 'number' ? input.stars : NaN;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    fieldErrors.stars = 'Rating must be a whole number from 1 to 5.';
  }

  let tags: string[] = [];
  if (input.tags != null) {
    if (!Array.isArray(input.tags)) {
      fieldErrors.tags = 'Tags must be a list.';
    } else {
      const seen = new Set<string>();
      for (const t of input.tags) {
        if (typeof t !== 'string' || !(RATING_TAGS as readonly string[]).includes(t)) {
          fieldErrors.tags = 'Unknown tag.';
          break;
        }
        seen.add(t);
      }
      tags = [...seen];
      if (tags.length > MAX_TAGS) fieldErrors.tags = `At most ${MAX_TAGS} tags.`;
    }
  }

  let comment: string | null = null;
  if (input.comment != null) {
    if (typeof input.comment !== 'string') {
      fieldErrors.comment = 'Comment must be text.';
    } else {
      const trimmed = input.comment.trim();
      if (trimmed.length > MAX_COMMENT_LEN) fieldErrors.comment = `Comment must be ${MAX_COMMENT_LEN} characters or fewer.`;
      comment = trimmed.length ? trimmed : null;
    }
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, stars, tags, comment };
}

export async function rateTrip(input: RateInput): Promise<RateResult> {
  const { bookingId, passengerId } = input;
  const stars = input.stars;
  const tags = input.tags ?? [];
  const comment = input.comment ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize concurrent raters on this booking row before reading rating/assignment state.
      await tx.$queryRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;

      const booking = await tx.booking.findFirst({
        where: { id: bookingId, passengerId },
        select: { id: true, status: true },
      });
      if (!booking) return err(404, 'NOT_FOUND', 'Ride not found.');
      if (booking.status !== 'COMPLETED') {
        return err(409, 'NOT_COMPLETED', 'You can rate a ride only after it is completed.');
      }

      const existing = await tx.tripRating.findUnique({ where: { bookingId }, select: { id: true } });
      if (existing) return err(409, 'ALREADY_RATED', 'This ride has already been rated.');

      // The driver who actually completed the trip.
      const completing = await tx.assignment.findFirst({
        where: { bookingId, reason: 'completed' },
        select: { driverId: true },
        orderBy: { endedAt: 'desc' },
      });
      if (!completing) return err(409, 'NO_DRIVER', 'This ride has no completing driver to rate.');

      await tx.tripRating.create({
        data: {
          bookingId,
          driverId: completing.driverId,
          passengerId,
          stars,
          tags: tags.length ? JSON.stringify(tags) : null,
          comment,
        },
      });

      const driver = await tx.driver.update({
        where: { id: completing.driverId },
        data: { ratingTotal: { increment: stars }, ratingCount: { increment: 1 } },
        select: { ratingTotal: true, ratingCount: true },
      });

      await recordEvent(tx, {
        eventType: 'trip.rated',
        aggregateType: 'rating',
        aggregateId: bookingId,
        aggregateVersion: 1,
        correlationId: bookingId,
        payload: {
          bookingId,
          driverPseudo: driverPseudo(completing.driverId),
          stars,
          tagCount: tags.length,
          hasComment: comment != null,
        },
      });

      return {
        ok: true,
        stars,
        driver: { ratingAvg: driver.ratingTotal / driver.ratingCount, ratingCount: driver.ratingCount },
      };
    });
  } catch (e: unknown) {
    // Unique violation = a concurrent rater won the race; treat as already-rated.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return err(409, 'ALREADY_RATED', 'This ride has already been rated.');
    }
    throw e;
  }
}

// Driver aggregate for dashboards: rounded average + count (null average when no ratings yet).
export function driverRatingSummary(d: { ratingTotal: number; ratingCount: number }): {
  average: number | null;
  count: number;
} {
  if (d.ratingCount <= 0) return { average: null, count: 0 };
  return { average: Math.round((d.ratingTotal / d.ratingCount) * 10) / 10, count: d.ratingCount };
}
