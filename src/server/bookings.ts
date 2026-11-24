import { lookupPostcode } from '@/server/postcode';
import { SHARE_MAX_PEOPLE, SHARE_MAX_BAGS } from '@/lib/share';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { startSearchTx } from '@/server/dispatch/search';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { haversineMeters, pointInPolygon } from '@/lib/geo';
import { bookingReference, sha256, encryptReceipt, decryptReceipt } from '@/lib/crypto';
import { createGrantTx } from '@/lib/tracking';
import { CreateBookingInput } from '@/lib/validation';
import { nicosiaWallTimeToUtc } from '@/lib/timezone';
import { consumeQuote } from '@/server/quote';
import { recordEvent, bookingEventPayload } from '@/server/events';
import { Prisma } from '@prisma/client';
import { isShareRoute } from '@/lib/share';

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
  passengerId?: string, // owning passenger account (Task 014)
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

  // 1b. Only on the island of Cyprus (2026-11-24, operator) — before the admin's service area.
  if (!onCyprusIsland(input.pickup)) return fail(422, 'OFF_ISLAND', 'Pickup is not on the island of Cyprus.', { pickup: 'Not on Cyprus.' });
  if (!onCyprusIsland(input.dropoff)) return fail(422, 'OFF_ISLAND', 'Destination is not on the island of Cyprus.', { dropoff: 'Not on Cyprus.' });
  if (input.stop && !onCyprusIsland(input.stop)) return fail(422, 'OFF_ISLAND', 'The stop is not on the island of Cyprus.', { stop: 'Not on Cyprus.' });

  // 2. Service area (both stops inside configured polygon)
  const poly = settings.serviceAreaPolygon;
  const pIn = pointInPolygon({ lat: input.pickup.lat, lng: input.pickup.lng }, poly);
  const dIn = pointInPolygon({ lat: input.dropoff.lat, lng: input.dropoff.lng }, poly);
  if (!pIn) return fail(422, 'OUT_OF_AREA', 'Pickup is outside the configured service area.', { pickup: 'Outside service area.' });
  if (!dIn) return fail(422, 'OUT_OF_AREA', 'Destination is outside the configured service area.', { dropoff: 'Outside service area.' });
  if (input.stop && !pointInPolygon({ lat: input.stop.lat, lng: input.stop.lng }, poly)) {
    return fail(422, 'OUT_OF_AREA', 'The stop is outside the configured service area.', { stop: 'Outside service area.' });
  }

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
      l: input.luggageCount ?? null, // price-bearing: a changed luggage count is a different request
      q: input.quoteId ?? null, // a different accepted quote is a different request
      name: input.passengerName,
      phone: input.phone,
      note: input.note || '',
      // Only when present, so hashes of requests without a flight number stay unchanged.
      ...(input.flightNumber ? { f: input.flightNumber } : {}),
      ...(input.stop ? { st: input.stop } : {}),
      ...(input.shareOptIn ? { sh: [input.shareMaxExtraMin ?? null, input.childCount ?? 0, input.shareWaitMin ?? null, input.shareEarlyMin ?? 0, input.shareTerms ?? null, input.sharePickupFrom ?? null] } : {}),
      ...(!input.shareOptIn && input.childCount ? { ch: input.childCount } : {}),
    }),
  );
  // Ride-share only where it is offered: airport or intercity, no intermediate stop.
  const shareOptIn = !!input.shareOptIn && !input.stop && isShareRoute(input.pickup, input.dropoff);

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
  // Pre-booking WITH a co-rider (operator 2026-11-22): at least settings.shareMinMinutes ahead (3 h), so there is time
  // to find the co-rider, wait for both answers and still give the pair to a driver.
  if (shareOptIn && (input.passengerCount > SHARE_MAX_PEOPLE || (input.luggageCount ?? 0) > SHARE_MAX_BAGS)) {
    return fail(422, 'SHARE_TOO_BIG', `With a co-rider: at most ${SHARE_MAX_PEOPLE} people and ${SHARE_MAX_BAGS} suitcases.`, { shareOptIn: 'Too many people or suitcases.' });
  }
  if (scheduledAt && shareOptIn && scheduledAt.getTime() < Date.now() + settings.shareMinMinutes * 60_000) {
    return fail(422, 'SHARE_TOO_SOON', `A ride with a co-rider must be booked at least ${Math.round(settings.shareMinMinutes / 60 * 10) / 10} h ahead.`, { shareOptIn: `At least ${settings.shareMinMinutes} minutes ahead.` });
  }
  // «Быть на месте с … до …» (2026-11-22): the app sends the arrival window and a pickup time it
  // computed from the road time. The window is kept on the booking; the pickup must leave room to
  // arrive by the end of it, and a co-rider may move it EARLIER by up to the window's width only.
  let arrive: { from: Date; by: Date } | null = null;
  if (scheduledAt && input.arriveFrom && input.arriveBy) {
    const f = nicosiaWallTimeToUtc(input.arriveFrom), t = nicosiaWallTimeToUtc(input.arriveBy);
    if (!f.ok || !t.ok) return fail(422, 'VALIDATION', 'Invalid arrival window.', { arriveBy: 'Pick a valid time.' });
    const width = (t.utc.getTime() - f.utc.getTime()) / 60_000;
    if (width < 15 || width > 180) return fail(422, 'VALIDATION', 'Arrival window must be 15 min – 3 h.', { arriveBy: '15 min – 3 h.' });
    if (scheduledAt.getTime() > t.utc.getTime() - 5 * 60_000) return fail(422, 'VALIDATION', 'Pickup is too late for that arrival time.', { arriveBy: 'Too late.' });
    arrive = { from: f.utc, by: t.utc };
  }
  // «Попутчик −30%» terms (TZ 2026-11-23): a pre-booking with a co-rider and an arrival window gets a pickup
  // interval [from, scheduledAt]. By default it is as wide as the window (the computed «Подача 13:00–14:00»);
  // «Изменить» may narrow it or make it one exact time. Only bookings that saw these terms are paired
  // without a question; the snapshot (version, time, interval, booked pickup and price) stays on the booking.
  let terms: { from: Date; to: Date } | null = null;
  if (scheduledAt && shareOptIn && arrive && input.shareTerms === config.share.termsVersion) {
    const width = arrive.by.getTime() - arrive.from.getTime();
    let from = new Date(scheduledAt.getTime() - width);
    if (input.sharePickupFrom) {
      const pf = nicosiaWallTimeToUtc(input.sharePickupFrom);
      if (!pf.ok) return fail(422, 'VALIDATION', 'Invalid pickup time.', { sharePickupFrom: 'Pick a valid time.' });
      if (pf.utc.getTime() > scheduledAt.getTime() || scheduledAt.getTime() - pf.utc.getTime() > width + 60_000) {
        return fail(422, 'VALIDATION', 'The pickup interval must lie inside the computed one.', { sharePickupFrom: 'Outside the interval.' });
      }
      from = pf.utc;
    }
    terms = { from, to: scheduledAt };
  }

  // 6b. Optional fare quote: validate ownership/expiry/payload and snapshot it onto the
  // booking (the client-supplied price is never trusted).
  let fare: { fareCents: number; priceType: string; fareBreakdown: string; minCents: number | null; minZone: string | null } | null = null;
  if (input.quoteId) {
    const cq = await consumeQuote(input.quoteId, {
      pickup: input.pickup, dropoff: input.dropoff, stop: input.stop ?? null, vClass: input.vClass,
      passengerCount: input.passengerCount, luggageCount: input.luggageCount,
      scheduledAtUtc: scheduledAt ? scheduledAt.toISOString() : null, // must match the quoted journey time
    });
    if (!cq.ok) {
      return fail(422, cq.code, cq.code === 'QUOTE_EXPIRED' ? 'The price estimate expired — refresh it.' : 'The price estimate no longer matches this trip — refresh it.');
    }
    fare = { fareCents: cq.totalCents, priceType: cq.priceType, fareBreakdown: cq.breakdown, minCents: cq.minCents, minZone: cq.minZone };
  }

  // 7. Atomically claim the key + create booking + event + tracking grant + store
  // the encrypted response. If the claim collides (concurrent create), the whole
  // transaction rolls back (no orphan booking) and we replay the winner's receipt.
  const reference = await uniqueReference();
  // Immediate rides enter autonomous dispatch right away (SEARCHING + a DispatchJob the
  // background worker picks up). Scheduled rides stay REQUESTED until their lead window
  // (scheduled-ride automation promotes them to SEARCHING later).
  const initialStatus = scheduledAt ? 'REQUESTED' : 'SEARCHING';
  // Destination postcode for the driver (best effort, ≤ 2 s per source; never fails the booking).
  const dropoffPostcode = await lookupPostcode(input.dropoff.lat, input.dropoff.lng, input.dropoff.label).catch(() => null);
  try {
    const body = await prisma.$transaction(async (tx) => {
      await tx.idempotencyReceipt.create({
        data: { scope: IDEMPOTENCY_SCOPE, key: idempotencyKey, requestHash, responseJson: '', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      const b = await tx.booking.create({
        data: {
          reference,
          pickupLat: input.pickup.lat, pickupLng: input.pickup.lng, pickupLabel: input.pickup.label,
          dropoffLat: input.dropoff.lat, dropoffLng: input.dropoff.lng, dropoffLabel: input.dropoff.label, dropoffPostcode,
          ...(input.stop ? { stopLat: input.stop.lat, stopLng: input.stop.lng, stopLabel: input.stop.label } : {}),
          passengerName: input.passengerName, phone: input.phone, note: input.note || null, flightNumber: input.flightNumber ?? null,
          vClass: input.vClass, passengerCount: input.passengerCount, luggageCount: input.luggageCount ?? 0, scheduledAt, status: initialStatus, ...(arrive ? { arriveFrom: arrive.from, arriveBy: arrive.by } : {}),
          childCount: input.childCount ?? 0,
          ...(shareOptIn ? { shareOptIn: true, shareMaxExtraMin: input.shareMaxExtraMin ?? config.share.defaultMaxExtraMin, ...(scheduledAt ? (arrive ? { shareWaitMin: 0, shareEarlyMin: Math.round((arrive.by.getTime() - arrive.from.getTime()) / 60_000) } : { shareWaitMin: input.shareWaitMin ?? config.share.defaultWaitMin, shareEarlyMin: input.shareEarlyMin ?? 0 }) : {}) } : {}),
          ...(terms ? {
            shareTermsVersion: config.share.termsVersion, shareTermsAt: new Date(), sharePickupFrom: terms.from, sharePickupTo: terms.to,
            shareBookedPickupAt: terms.to, shareBookedCents: fare?.fareCents ?? null,
            shareWaitMin: 0, shareEarlyMin: Math.round((terms.to.getTime() - terms.from.getTime()) / 60_000), shareMaxExtraMin: config.share.termsMaxExtraMin,
          } : {}),
          ...(passengerId ? { passengerId } : {}),
          ...(fare ? { quoteId: input.quoteId, fareCents: fare.fareCents, priceType: fare.priceType, fareBreakdown: fare.fareBreakdown, fareMinCents: fare.minCents, fareMinZone: fare.minZone } : {}),
        },
      });
      await tx.bookingEvent.create({ data: { bookingId: b.id, type: 'CREATED', actorType: 'PASSENGER', afterStatus: initialStatus } });
      // Durable domain event in the SAME transaction (rollback removes it too).
      await recordEvent(tx, {
        eventType: scheduledAt ? 'booking.scheduled' : 'booking.requested',
        aggregateType: 'booking', aggregateId: b.id, aggregateVersion: b.revision,
        occurredAt: b.createdAt,
        payload: bookingEventPayload(b),
      });
      if (initialStatus === 'SEARCHING') {
        await startSearchTx(tx, b.id);
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
