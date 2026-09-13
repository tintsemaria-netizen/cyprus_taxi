import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { haversineMeters, pointInPolygon } from '@/lib/geo';
import { bookingReference, sha256, encryptReceipt, decryptReceipt } from '@/lib/crypto';
import { createGrantTx } from '@/lib/tracking';
import { CreateBookingInput } from '@/lib/validation';
import { nicosiaWallTimeToUtc } from '@/lib/timezone';
import { consumeQuote } from '@/server/quote';
import { Prisma } from '@prisma/client';

export type CreateResult =
  | { ok: true; body: BookingCreatedBody }
  | { ok: false; status: number; code: string; message: string; fieldErrors?: Record<string, string>; extra?: Record<string, unknown> };

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
  baseUrl?: string, // origin the passenger is using (multi-domain); falls back to APP_BASE_URL
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
  // 4. Idempotency request hash over the meaningful payload.
  const requestHash = sha256(
    JSON.stringify({
      p: input.pickup,
      d: input.dropoff,
      w: input.when,
      s: input.scheduledAt || null,
      so: input.scheduleOffsetMin ?? null,
      c: input.vClass,
      n: input.passengerCount,
      name: input.passengerName,
      phone: input.phone,
      note: input.note || '',
    }),
  );

  // 5. Replay an existing receipt BEFORE time-dependent schedule validation, so a
  // valid original booking is recoverable even if its scheduled time is now inside
  // the min-lead window. Poll briefly while a concurrent create is still in flight.
  const replay = await replayReceipt(idempotencyKey, requestHash);
  if (replay.kind === 'conflict') return fail(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different request.');
  if (replay.kind === 'hit') return { ok: true, body: replay.body };
  // replay.kind === 'miss' → this is a fresh request; proceed to full validation.

  // 6. Schedule validation (Europe/Nicosia wall time → UTC, DST-aware).
  let scheduledAt: Date | null = null;
  if (input.when === 'SCHEDULE') {
    if (!input.scheduledAt) return fail(422, 'VALIDATION', 'Scheduled time required.', { scheduledAt: 'Required.' });
    const conv = nicosiaWallTimeToUtc(input.scheduledAt, input.scheduleOffsetMin);
    if (!conv.ok) {
      if (conv.reason === 'GAP') return fail(422, 'SCHEDULE_NONEXISTENT', 'That local time does not exist (clocks spring forward).', { scheduledAt: 'Pick a valid time.' });
      return {
        ok: false, status: 422, code: 'SCHEDULE_AMBIGUOUS',
        message: 'That local time is ambiguous (clocks fall back). Choose which occurrence.',
        fieldErrors: { scheduledAt: 'Ambiguous time — choose an occurrence.' },
        extra: { scheduleOptions: conv.options ?? [] },
      };
    }
    const when = conv.utc;
    const now = Date.now();
    const minMs = settings.scheduleMinMinutes * 60 * 1000;
    const maxMs = settings.scheduleMaxDays * 24 * 60 * 60 * 1000;
    if (when.getTime() < now + minMs) return fail(422, 'SCHEDULE_TOO_SOON', 'Scheduled time is too soon.', { scheduledAt: `At least ${settings.scheduleMinMinutes} minutes ahead.` });
    if (when.getTime() > now + maxMs) return fail(422, 'SCHEDULE_TOO_FAR', 'Scheduled time is too far ahead.', { scheduledAt: `At most ${settings.scheduleMaxDays} days ahead.` });
    scheduledAt = when;
  }

  // 6b. Optional fare quote: validate ownership/expiry/payload and snapshot it onto the
  // booking (the client-supplied price is never trusted).
  let fare: { fareCents: number; priceType: string; fareBreakdown: string } | null = null;
  if (input.quoteId) {
    const cq = await consumeQuote(input.quoteId, {
      pickup: input.pickup, dropoff: input.dropoff, vClass: input.vClass,
      passengerCount: input.passengerCount, luggageCount: input.luggageCount,
    });
    if (!cq.ok) {
      return fail(422, cq.code, cq.code === 'QUOTE_EXPIRED' ? 'The price estimate expired — refresh it.' : 'The price estimate no longer matches this trip — refresh it.');
    }
    fare = { fareCents: cq.totalCents, priceType: cq.priceType, fareBreakdown: cq.breakdown };
  }

  // 7. Atomically claim the key + create booking + event + tracking grant + store
  // the encrypted response. If the claim collides (concurrent create), the whole
  // transaction rolls back (no orphan booking) and we replay the winner's receipt.
  const reference = await uniqueReference();
  // Immediate rides enter autonomous dispatch right away (SEARCHING + a DispatchJob the
  // background worker picks up). Scheduled rides stay REQUESTED until their lead window
  // (scheduled-ride automation promotes them to SEARCHING later).
  const initialStatus = scheduledAt ? 'REQUESTED' : 'SEARCHING';
  try {
    const body = await prisma.$transaction(async (tx) => {
      await tx.idempotencyReceipt.create({
        data: { scope: IDEMPOTENCY_SCOPE, key: idempotencyKey, requestHash, responseJson: '', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      const b = await tx.booking.create({
        data: {
          reference,
          pickupLat: input.pickup.lat, pickupLng: input.pickup.lng, pickupLabel: input.pickup.label,
          dropoffLat: input.dropoff.lat, dropoffLng: input.dropoff.lng, dropoffLabel: input.dropoff.label,
          passengerName: input.passengerName, phone: input.phone, note: input.note || null,
          vClass: input.vClass, passengerCount: input.passengerCount, scheduledAt, status: initialStatus,
          ...(fare ? { quoteId: input.quoteId, fareCents: fare.fareCents, priceType: fare.priceType, fareBreakdown: fare.fareBreakdown } : {}),
        },
      });
      await tx.bookingEvent.create({ data: { bookingId: b.id, type: 'CREATED', actorType: 'PASSENGER', afterStatus: initialStatus } });
      if (initialStatus === 'SEARCHING') {
        await tx.dispatchJob.create({ data: { bookingId: b.id, deadlineAt: new Date(Date.now() + 180 * 1000) } });
      }
      const grant = await createGrantTx(tx, b.id, scheduledAt ?? new Date());
      const built: BookingCreatedBody = {
        bookingId: b.id,
        reference: b.reference,
        status: b.status,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
        tracking: { token: grant.token, url: `${baseUrl || config.appBaseUrl}/track#token=${grant.token}`, expiresAt: grant.expiresAt.toISOString() },
      };
      await tx.idempotencyReceipt.update({
        where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: idempotencyKey } },
        data: { responseJson: encryptReceipt(JSON.stringify(built)) },
      });
      return built;
    });
    return { ok: true, body };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Lost the claim race (or reference collision). Replay the winner's receipt.
      const again = await replayReceipt(idempotencyKey, requestHash);
      if (again.kind === 'hit') return { ok: true, body: again.body };
      if (again.kind === 'conflict') return fail(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different request.');
      return fail(409, 'IN_FLIGHT', 'A matching request is still being processed. Retry shortly.');
    }
    throw e;
  }
}

type ReplayResult =
  | { kind: 'miss' }
  | { kind: 'hit'; body: BookingCreatedBody }
  | { kind: 'conflict' };

// Look up an idempotency receipt; decrypt and return its response, poll if still
// in flight, or report a payload conflict. `miss` means no receipt exists yet.
async function replayReceipt(key: string, requestHash: string): Promise<ReplayResult> {
  for (let i = 0; i < 25; i++) {
    const existing = await prisma.idempotencyReceipt.findUnique({ where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key } } });
    if (!existing) return { kind: 'miss' };
    if (existing.requestHash !== requestHash) return { kind: 'conflict' };
    if (existing.responseJson) return { kind: 'hit', body: JSON.parse(decryptReceipt(existing.responseJson)) as BookingCreatedBody };
    await sleep(120); // claimed but not yet committed — wait for the winner
  }
  return { kind: 'miss' };
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
