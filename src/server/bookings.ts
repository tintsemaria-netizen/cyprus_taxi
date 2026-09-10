import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { haversineMeters, pointInPolygon } from '@/lib/geo';
import { bookingReference, sha256 } from '@/lib/crypto';
import { createGrant } from '@/lib/tracking';
import { CreateBookingInput } from '@/lib/validation';
import { Prisma } from '@prisma/client';

export type CreateResult =
  | { ok: true; body: BookingCreatedBody }
  | { ok: false; status: number; code: string; message: string; fieldErrors?: Record<string, string> };

export interface BookingCreatedBody {
  bookingId: string;
  reference: string;
  status: string;
  scheduledAt: string | null;
  tracking: { token: string; url: string; expiresAt: string };
}

const IDEMPOTENCY_SCOPE = 'bookings';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function createBooking(
  input: CreateBookingInput,
  idempotencyKey: string,
): Promise<CreateResult> {
  const settings = await getSettings();

  // 1. Class capacity
  const cls = settings.classes.find((c) => c.key === input.vClass);
  if (!cls) return fail(422, 'VALIDATION', 'Unknown vehicle class.', { vClass: 'Unknown class.' });
  if (input.passengerCount > cls.maxPassengers) {
    return fail(422, 'VALIDATION', 'Too many passengers for this class.', {
      passengerCount: `Max ${cls.maxPassengers} for ${cls.label}.`,
    });
  }

  // 2. Service area (both stops inside configured polygon)
  const poly = settings.serviceAreaPolygon;
  const pIn = pointInPolygon({ lat: input.pickup.lat, lng: input.pickup.lng }, poly);
  const dIn = pointInPolygon({ lat: input.dropoff.lat, lng: input.dropoff.lng }, poly);
  if (!pIn) return fail(422, 'OUT_OF_AREA', 'Pickup is outside the configured service area.', { pickup: 'Outside service area.' });
  if (!dIn) return fail(422, 'OUT_OF_AREA', 'Destination is outside the configured service area.', { dropoff: 'Outside service area.' });

  // 3. Minimum distance between stops
  const dist = haversineMeters(input.pickup, input.dropoff);
  if (dist < settings.minStopDistanceMeters) {
    return fail(422, 'STOPS_TOO_CLOSE', 'Pickup and destination are effectively the same place.', {
      dropoff: `Choose stops at least ${settings.minStopDistanceMeters} m apart.`,
    });
  }

  // 4. Schedule validation
  let scheduledAt: Date | null = null;
  if (input.when === 'SCHEDULE') {
    if (!input.scheduledAt) return fail(422, 'VALIDATION', 'Scheduled time required.', { scheduledAt: 'Required.' });
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) return fail(422, 'VALIDATION', 'Invalid scheduled time.', { scheduledAt: 'Invalid.' });
    const now = Date.now();
    const minMs = settings.scheduleMinMinutes * 60 * 1000;
    const maxMs = settings.scheduleMaxDays * 24 * 60 * 60 * 1000;
    if (when.getTime() < now + minMs) {
      return fail(422, 'SCHEDULE_TOO_SOON', 'Scheduled time is too soon.', {
        scheduledAt: `At least ${settings.scheduleMinMinutes} minutes ahead.`,
      });
    }
    if (when.getTime() > now + maxMs) {
      return fail(422, 'SCHEDULE_TOO_FAR', 'Scheduled time is too far ahead.', {
        scheduledAt: `At most ${settings.scheduleMaxDays} days ahead.`,
      });
    }
    scheduledAt = when;
  }

  // 5. Idempotency — request hash over the meaningful payload
  const requestHash = sha256(
    JSON.stringify({
      p: input.pickup,
      d: input.dropoff,
      w: input.when,
      s: input.scheduledAt || null,
      c: input.vClass,
      n: input.passengerCount,
      name: input.passengerName,
      phone: input.phone,
      note: input.note || '',
    }),
  );

  // Try to claim the idempotency key.
  let owner = false;
  try {
    await prisma.idempotencyReceipt.create({
      data: {
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        responseJson: '',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    owner = true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      owner = false;
    } else {
      throw e;
    }
  }

  if (!owner) {
    // Someone else created (or is creating) this key. Validate payload match, then
    // return their stored response (poll briefly if still in flight).
    for (let i = 0; i < 25; i++) {
      const existing = await prisma.idempotencyReceipt.findUnique({
        where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: idempotencyKey } },
      });
      if (!existing) break;
      if (existing.requestHash !== requestHash) {
        return fail(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different request.');
      }
      if (existing.responseJson) {
        return { ok: true, body: JSON.parse(existing.responseJson) as BookingCreatedBody };
      }
      await sleep(120);
    }
    return fail(409, 'IN_FLIGHT', 'A matching request is still being processed. Retry shortly.');
  }

  // 6. Create the booking, initial event and tracking grant.
  const reference = await uniqueReference();
  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        reference,
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        pickupLabel: input.pickup.label,
        dropoffLat: input.dropoff.lat,
        dropoffLng: input.dropoff.lng,
        dropoffLabel: input.dropoff.label,
        passengerName: input.passengerName,
        phone: input.phone,
        note: input.note || null,
        vClass: input.vClass,
        passengerCount: input.passengerCount,
        scheduledAt,
        status: 'REQUESTED',
      },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: b.id,
        type: 'CREATED',
        actorType: 'PASSENGER',
        afterStatus: 'REQUESTED',
      },
    });
    return b;
  });

  const grant = await createGrant(booking.id, scheduledAt ?? new Date());
  const body: BookingCreatedBody = {
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status,
    scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
    tracking: {
      token: grant.token,
      url: `${config.appBaseUrl}/track#token=${grant.token}`,
      expiresAt: grant.expiresAt.toISOString(),
    },
  };

  await prisma.idempotencyReceipt.update({
    where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: idempotencyKey } },
    data: { responseJson: JSON.stringify(body) },
  });

  return { ok: true, body };
}

async function uniqueReference(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const ref = bookingReference();
    const exists = await prisma.booking.findUnique({ where: { reference: ref } });
    if (!exists) return ref;
  }
  throw new Error('Could not allocate a unique booking reference.');
}

function fail(status: number, code: string, message: string, fieldErrors?: Record<string, string>): CreateResult {
  return { ok: false, status, code, message, fieldErrors };
}
