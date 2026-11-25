import { meterWaitingCents } from '@/lib/tariff';
import { ensureAirportAreas } from '@/server/no-go';
import { isFixedPrice } from '@/lib/price-type';
import { enqueueReceiptEmail } from '@/server/email/receipts';
import { completedTotalCents } from '@/lib/fare-total';
import { randomInt } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';
import { isAirportPoint } from '@/lib/airports';
import { startSearchTx } from './search';
import { enqueueDriver, enqueuePassenger, enqueuePassengerDriverNews } from '@/server/push';
import { recordEvent, driverPseudo } from '@/server/events';
import { afterLegEndedTx, legCompletedTx, leaveShareTx, noShowFeeCents } from '@/server/share';
import { gpsMeterFor } from '@/server/gps-meter';

// M3 trip lifecycle after assignment: arrival + pickup waiting, code-gated start,
// immutable fare receipt on completion, and pre-pickup rematch. Booking-status
// invariants stay in one place; the generic status machine is untouched for these.

export type LifeResult =
  | { ok: true; status: string; revision: number; extra?: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

const ok = (status: string, revision: number, extra?: Record<string, unknown>): LifeResult => ({ ok: true, status, revision, extra });
const err = (status: number, code: string, message: string): LifeResult => ({ ok: false, status, code, message });

// 4-digit passenger→driver start code (leading zeros allowed).
export function generateStartCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

// Airports allow a meeting-point pickup where strict GPS proximity is impractical (§6.4).
function isAirportPickup(lat: number, lng: number): boolean {
  return isAirportPoint(lat, lng);
}

type ActorRef = { type: 'DRIVER' | 'STAFF' | 'SYSTEM'; id?: string };

async function activeAssignmentFor(tx: Prisma.TransactionClient, bookingId: string, driverId: string) {
  const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
  if (!a || a.driverId !== driverId) return null;
  return a;
}

function computeAccrued(arrivedAt: Date, endedAt: Date, graceSeconds: number, rateCentsPerMin: number): number {
  const elapsed = Math.max(0, (endedAt.getTime() - arrivedAt.getTime()) / 1000);
  const paidSec = Math.max(0, elapsed - graceSeconds);
  return Math.round((paidSec / 60) * rateCentsPerMin);
}

// ---- Shared finalizers (the ONLY place these transitions are written) ----

async function finalizeArrival(tx: Prisma.TransactionClient, bookingId: string, actor: ActorRef): Promise<LifeResult> {
  const now = new Date();
  await tx.waitingSession.upsert({
    where: { bookingId },
    update: {}, // never reset an existing waiting session (refresh/retry safe)
    create: { bookingId, arrivedAt: now, graceSeconds: config.dispatch.waitingGraceSeconds, paidRateCentsPerMin: config.dispatch.waitingRateCentsPerMin },
  });
  const u = await tx.booking.update({ where: { id: bookingId }, data: { status: 'ARRIVED', arrivedAt: now, revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId, type: 'ARRIVED', actorType: actor.type, actorId: actor.id, beforeStatus: 'EN_ROUTE', afterStatus: 'ARRIVED' } });
  await recordEvent(tx, { eventType: 'booking.arrived', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: u.revision, correlationId: bookingId, occurredAt: now, payload: { bookingId, status: 'ARRIVED', actorType: actor.type } });
  await enqueuePassenger(tx, bookingId, 'Your driver has arrived', 'Your driver is waiting at the pickup point.', { msg: { k: 'ride.arrived' } });
  return ok(u.status, u.revision);
}

async function finalizeStart(tx: Prisma.TransactionClient, bookingId: string, actor: ActorRef): Promise<LifeResult> {
  const now = new Date();
  const w = await tx.waitingSession.findUnique({ where: { bookingId } });
  if (w && !w.endedAt) {
    const accrued = computeAccrued(w.arrivedAt, now, w.graceSeconds, w.paidRateCentsPerMin);
    await tx.waitingSession.update({ where: { bookingId }, data: { endedAt: now, accruedCents: accrued } });
  }
  const u = await tx.booking.update({ where: { id: bookingId }, data: { status: 'IN_PROGRESS', revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId, type: 'TRIP_STARTED', actorType: actor.type, actorId: actor.id, beforeStatus: 'ARRIVED', afterStatus: 'IN_PROGRESS' } });
  await recordEvent(tx, { eventType: 'booking.started', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: u.revision, correlationId: bookingId, occurredAt: now, payload: { bookingId, status: 'IN_PROGRESS', actorType: actor.type, waitingCents: w?.accruedCents ?? 0 } });
  return ok(u.status, u.revision);
}

async function finalizeCompletion(
  tx: Prisma.TransactionClient,
  b: { id: string; fareCents: number | null; priceType: string | null; fareBreakdown: string | null },
  a: { id: string; driverId: string },
  actor: ActorRef,
  meterCents: number | null = null,
): Promise<LifeResult> {
  const w = await tx.waitingSession.findUnique({ where: { bookingId: b.id } });
  // Paid waiting at the intermediate stop (2026-11-15) is added on top of pickup waiting.
  const stopWait = await closeStopWaiting(tx, b.id, new Date());
  const waitingCents = (w?.accruedCents ?? 0) + stopWait;
  const priceType = b.priceType ?? 'REGULATED_METER_ESTIMATE';
  const isUpfront = isFixedPrice(priceType);
  // Upfront = the accepted committed price is the final amount. Regulated estimate =
  // no fabricated meter total; the driver settles the metered fare (finalCents stays null).
  const finalCents = isUpfront ? b.fareCents ?? null : null;
  const basis = {
    priceType,
    estimateCents: b.fareCents ?? null,
    waitingCents,
    note: priceType === 'REGULATED_FIXED' ? 'Fixed airport fare (final).' : priceType === 'SHARED_FIXED' ? 'Shared ride price after the co-rider discount (final).' : isUpfront ? 'Accepted upfront price (final).' : 'Estimate; final regulated meter amount is settled with the driver.',
    breakdown: b.fareBreakdown ? safeParse(b.fareBreakdown) : null,
  };
  const existing = await tx.fare.findUnique({ where: { bookingId: b.id } }); // immutable: write once
  if (!existing) {
    // GPS taximeter reading, kept next to the estimate for comparison (not charged).
    const meter = await gpsMeterFor(tx, b.id, a.driverId).catch(() => null);
    await tx.fare.create({
      data: {
        bookingId: b.id, priceType, currency: config.currency,
        estimateCents: b.fareCents ?? null, waitingCents, finalCents,
        ...(meter ? { gpsMeterCents: meter.totalCents, gpsMeterKm: meter.totalKm, gpsMeterSlowSec: meter.slowSec, gpsMeterGapSec: meter.gapSec } : {}),
        basis: JSON.stringify(basis), paymentMethod: 'CASH_TO_DRIVER', paymentStatus: 'PENDING',
      },
    });
  }
  await tx.assignment.update({ where: { id: a.id }, data: { endedAt: new Date(), reason: 'completed', activeBookingId: null, activeDriverId: null, activeVehicleId: null, queuedDriverId: null } });
  // A shared ride's other leg may still be in the car: it takes over and the driver stays busy.
  // The amount the driver typed on the completion screen (meter ride): recorded once, final from now on.
  if (meterCents != null && !isUpfront && !(await tx.driverSettlement.findFirst({ where: { bookingId: b.id }, select: { id: true } }))) {
    await tx.driverSettlement.create({ data: { bookingId: b.id, driverId: a.driverId, assignmentId: a.id, reportedFinalCents: meterCents, currency: config.currency, paymentReceived: false, note: 'entered at completion', revision: 1, createdByType: 'DRIVER', createdById: a.driverId } });
  }
  await afterLegEndedTx(tx, a);
  const u = await tx.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED', revision: { increment: 1 } } });
  await legCompletedTx(tx, b.id);
  await tx.bookingEvent.create({ data: { bookingId: b.id, type: 'COMPLETED', actorType: actor.type, actorId: actor.id, beforeStatus: 'IN_PROGRESS', afterStatus: 'COMPLETED' } });
  // E-mailed receipt (2026-11-17): queued atomically with the completion; the worker sends it.
  await enqueueReceiptEmail(tx, b.id);
  // Completed-booking projection + a separate fare fact (money is analyzed from the fare
  // event; finalCents may be null under regulated metering — never coerced to 0).
  await recordEvent(tx, {
    eventType: 'booking.completed', aggregateType: 'booking', aggregateId: b.id, aggregateVersion: u.revision, correlationId: b.id,
    payload: { bookingId: b.id, status: 'COMPLETED', actorType: actor.type, driverPseudo: driverPseudo(a.driverId), priceType, estimateCents: b.fareCents ?? null, waitingCents, finalCents, currency: config.currency },
  });
  await recordEvent(tx, {
    eventType: 'fare.recorded', aggregateType: 'fare', aggregateId: b.id, aggregateVersion: 1, correlationId: b.id,
    // totalCents = the amount fixed at completion (src/lib/fare-total.ts), what admin analytics sums.
    payload: { bookingId: b.id, priceType, currency: config.currency, estimateCents: b.fareCents ?? null, waitingCents, finalCents, totalCents: completedTotalCents({ priceType, estimateCents: b.fareCents ?? null, waitingCents, finalCents }, meterCents), paymentMethod: 'CASH_TO_DRIVER', paymentStatus: 'PENDING' },
  });
  return ok(u.status, u.revision);
}

// ---- Driver actions (the normal, no-dispatcher path) ----

// EN_ROUTE → ARRIVED. Requires the driver's own assignment and fresh GPS within the
// arrival radius of pickup (airports exempt); opens a persisted waiting session.
export async function arriveAtPickup(bookingId: string, driverId: string, expectedRevision: number): Promise<LifeResult> {
  await ensureAirportAreas(); // the airport = a territory marked «это аэропорт» (2026-11-25)
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'EN_ROUTE') return err(409, 'BAD_STATE', 'You can only arrive while en route.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');
    if (!isAirportPickup(b.pickupLat, b.pickupLng)) {
      const loc = await tx.latestDriverLocation.findUnique({ where: { driverId } });
      if (!loc || computeFreshness(loc.sampledAt, loc.receivedAt) !== 'fresh') return err(409, 'NO_FRESH_GPS', 'Fresh GPS is required to confirm arrival.');
      const dist = haversineMeters({ lat: loc.lat, lng: loc.lng }, { lat: b.pickupLat, lng: b.pickupLng });
      if (dist > config.dispatch.arrivalRadiusMeters) return err(409, 'TOO_FAR', `You are ${Math.round(dist)} m from pickup. Get closer to confirm arrival.`);
    }
    return finalizeArrival(tx, bookingId, { type: 'DRIVER', id: driverId });
  });
  return r; // passenger arrival notification is enqueued inside finalizeArrival (atomic)
}

// ARRIVED → IN_PROGRESS. Gated by the start code only when the passenger switched one on
// (optional since 2026-11-16); without a code the driver starts with one tap.
export async function startTrip(bookingId: string, driverId: string, expectedRevision: number, code: string): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'ARRIVED') return err(409, 'BAD_STATE', 'You can only start after arriving.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');
    if (b.startCode && code.trim() !== b.startCode) return err(422, 'BAD_START_CODE', 'Incorrect start code. Ask the passenger for their 4-digit code.');
    return finalizeStart(tx, bookingId, { type: 'DRIVER', id: driverId });
  });
}

// IN_PROGRESS → COMPLETED. Writes the one immutable Fare record and frees the driver.
export async function completeTrip(bookingId: string, driverId: string, expectedRevision: number, meterCents?: number | null): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'IN_PROGRESS') return err(409, 'BAD_STATE', 'Only an in-progress trip can be completed.');
    const a = await activeAssignmentFor(tx, bookingId, driverId);
    if (!a) return err(403, 'FORBIDDEN', 'Not your assignment.');
    // The driver may change the amount ONLY here, before «Завершить» (operator 2026-11-24) — a meter
    // ride only (a fixed price stays), not below the pre-booking minimum. Afterwards it is locked.
    if (meterCents != null) {
      if (isFixedPrice(b.priceType)) return err(409, 'UPFRONT_FIXED', 'This ride has a fixed price.');
      if (!Number.isInteger(meterCents) || meterCents < 0 || meterCents > 100_000_00) return err(422, 'BAD_AMOUNT', 'Enter a valid amount.');
      if (b.fareMinCents != null && meterCents < b.fareMinCents) return err(422, 'BELOW_MINIMUM', `Minimum price here: at least €${(b.fareMinCents / 100).toFixed(2)}.`);
    }
    return finalizeCompletion(tx, b, a, { type: 'DRIVER', id: driverId }, meterCents ?? null);
  });
}

// ---- Intermediate stop (2026-11-15) ----
// While IN_PROGRESS with a stop: ARRIVED_AT_STOP → (optional) paid WAITING meter → CONTINUE to the
// destination. Sub-state lives in Booking.stop* timestamps; the status stays IN_PROGRESS.
// Stop waiting is the taximeter waiting tariff (no grace), started by the driver.

// Priced like the urban taximeter's waiting (€17/h day, €19/h night), added on top of the fare.
export function stopWaitCentsFor(startedAt: Date, endedAt: Date): number {
  return meterWaitingCents(startedAt, endedAt);
}

/** Stops the stop-waiting meter if it is running and returns the stop waiting charge in cents. */
async function closeStopWaiting(tx: Prisma.TransactionClient, bookingId: string, now: Date): Promise<number> {
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { stopWaitStartedAt: true, stopDepartedAt: true, stopWaitCents: true } });
  if (!b) return 0;
  if (b.stopWaitCents != null) return b.stopWaitCents;
  if (!b.stopWaitStartedAt) return 0;
  const cents = stopWaitCentsFor(b.stopWaitStartedAt, b.stopDepartedAt ?? now);
  await tx.booking.update({ where: { id: bookingId }, data: { stopWaitCents: cents, ...(b.stopDepartedAt ? {} : { stopDepartedAt: now }) } });
  return cents;
}

export type StopAction = 'arrived' | 'wait' | 'continue';

export async function driverStopAction(bookingId: string, driverId: string, action: StopAction): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.status !== 'IN_PROGRESS') return err(409, 'BAD_STATE', 'Only during the trip.');
    if (b.stopLat == null || b.stopLng == null) return err(409, 'NO_STOP', 'This ride has no stop.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');
    const now = new Date();
    let data: Prisma.BookingUpdateInput;
    let type: string;
    if (action === 'arrived') {
      if (b.stopArrivedAt) return ok(b.status, b.revision); // idempotent
      data = { stopArrivedAt: now }; type = 'STOP_ARRIVED';
    } else if (action === 'wait') {
      if (!b.stopArrivedAt || b.stopDepartedAt) return err(409, 'BAD_STATE', 'Paid waiting is only possible at the stop.');
      if (b.stopWaitStartedAt) return ok(b.status, b.revision);
      data = { stopWaitStartedAt: now }; type = 'STOP_WAIT_STARTED';
    } else {
      if (!b.stopArrivedAt) return err(409, 'BAD_STATE', 'Mark arrival at the stop first.');
      if (b.stopDepartedAt) return ok(b.status, b.revision);
      data = { stopDepartedAt: now, ...(b.stopWaitStartedAt ? { stopWaitCents: stopWaitCentsFor(b.stopWaitStartedAt, now) } : {}) };
      type = 'STOP_DEPARTED';
    }
    const u = await tx.booking.update({ where: { id: bookingId }, data: { ...data, revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type, actorType: 'DRIVER', actorId: driverId, beforeStatus: 'IN_PROGRESS', afterStatus: 'IN_PROGRESS' } });
    if (action === 'arrived') await enqueuePassenger(tx, bookingId, 'Arrived at your stop', 'Your driver is at the stop. Tell them when you are ready to continue.', { msg: { k: 'ride.atStop' } });
    return ok(u.status, u.revision);
  });
}

// ---- Audited staff overrides (exceptional; require a reason, recorded to AuditEvent) ----
// These bypass driver-only checks (GPS proximity, start code, ownership) but write the
// SAME validated state through the shared finalizers, so no accidental generic bypass.

async function auditOverride(tx: Prisma.TransactionClient, staffId: string, role: Role, action: string, bookingId: string, reason: string) {
  await tx.auditEvent.create({ data: { actorId: staffId, actorRole: role, action, target: bookingId, detail: reason } });
}

export async function staffMarkArrived(bookingId: string, expectedRevision: number, staffId: string, role: Role, reason: string): Promise<LifeResult> {
  if (!reason || reason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'A reason is required for an arrival override.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'EN_ROUTE') return err(409, 'BAD_STATE', 'Can only mark arrived from EN_ROUTE.');
    if (!(await tx.assignment.findFirst({ where: { activeBookingId: bookingId } }))) return err(409, 'NO_ASSIGNMENT', 'No active assignment.');
    await auditOverride(tx, staffId, role, 'OVERRIDE_ARRIVED', bookingId, reason);
    return finalizeArrival(tx, bookingId, { type: 'STAFF', id: staffId });
  });
}

export async function staffStartTrip(bookingId: string, expectedRevision: number, staffId: string, role: Role, reason: string): Promise<LifeResult> {
  if (!reason || reason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'A reason is required to start without the code.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'ARRIVED') return err(409, 'BAD_STATE', 'Can only start from ARRIVED.');
    if (!(await tx.assignment.findFirst({ where: { activeBookingId: bookingId } }))) return err(409, 'NO_ASSIGNMENT', 'No active assignment.');
    await auditOverride(tx, staffId, role, 'OVERRIDE_START', bookingId, reason);
    return finalizeStart(tx, bookingId, { type: 'STAFF', id: staffId });
  });
}

export async function staffCompleteTrip(bookingId: string, expectedRevision: number, staffId: string, role: Role, reason: string): Promise<LifeResult> {
  if (!reason || reason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'A reason is required for a completion override.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'IN_PROGRESS') return err(409, 'BAD_STATE', 'Only an in-progress trip can be completed.');
    const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
    if (!a) return err(409, 'NO_ASSIGNMENT', 'No active assignment.');
    await auditOverride(tx, staffId, role, 'OVERRIDE_COMPLETE', bookingId, reason);
    return finalizeCompletion(tx, b, a, { type: 'STAFF', id: staffId });
  });
}

// Rematch a pre-pickup booking (driver cancel or prolonged GPS loss): end the current
// assignment, exclude that driver, and put the booking back to SEARCHING with a fresh job.
// The passenger's accepted quote/fare snapshot on the booking is preserved unchanged.
export async function rematchBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  excludeDriverId: string,
  reason: string,
  actorType: 'DRIVER' | 'SYSTEM',
): Promise<void> {
  // A shared ride breaks up first: the other passenger goes back to the full price.
  await leaveShareTx(tx, bookingId, `rematch: ${reason}`);
  const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
  if (a) {
    await tx.assignment.update({ where: { id: a.id }, data: { endedAt: new Date(), reason, activeBookingId: null, activeDriverId: null, activeVehicleId: null, queuedDriverId: null } });
    await afterLegEndedTx(tx, a);
  }
  await tx.waitingSession.deleteMany({ where: { bookingId } });
  await startSearchTx(tx, bookingId, { triedDriverIds: [excludeDriverId] });
  const ub = await tx.booking.update({ where: { id: bookingId }, data: { status: 'SEARCHING', arrivedAt: null, revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId, type: 'REMATCH', actorType, actorId: actorType === 'DRIVER' ? excludeDriverId : undefined, afterStatus: 'SEARCHING', reason } });
  await recordEvent(tx, { eventType: 'booking.rematch', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: ub.revision, correlationId: bookingId, payload: { bookingId, status: 'SEARCHING', actorType, excludeDriverPseudo: driverPseudo(excludeDriverId), reason } });
  await enqueuePassengerDriverNews(tx, bookingId, 'change', 'Finding you another driver', 'Your previous driver became unavailable — we’re matching you again.', { k: 'ride.rematchUnavailable' });
  // Launch fixes §5 (ported 2026-11-23): the driver who lost it to the system (no GPS) is told why. A driver who cancelled himself already knows.
  if (actorType === 'SYSTEM') await enqueueDriver(tx, excludeDriverId, 'Ride reassigned', 'No location from your phone for too long — the ride was given to another driver.', { tag: `lost-${bookingId}`, dedupeKey: `lost-${bookingId}-${ub.revision}`, msg: { k: 'drv.rideLostGps' } });
}

// Driver cancels before pickup → automatic rematch (not a terminal cancel).
export async function driverCancelPrePickup(bookingId: string, driverId: string, expectedRevision: number, reason?: string): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(b.status)) return err(409, 'BAD_STATE', 'This trip cannot be released.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');
    await rematchBooking(tx, bookingId, driverId, reason || 'driver canceled before pickup', 'DRIVER');
    const updated = await tx.booking.findUnique({ where: { id: bookingId } });
    return ok(updated!.status, updated!.revision);
  }); // passenger rematch notification is enqueued inside rematchBooking (atomic)
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ---- Ride-share no-show (Task 022) ----
// The driver waited at the pickup of a shared ride (past the free waiting time) and the passenger
// never came. That leg is cancelled; on a pre-booked pair the no-show owes noShowFeePct of their
// shared price (recorded on the group — charged by card once card payments exist). The other
// passenger keeps riding at the full price (leaveShareTx).
export async function driverShareNoShow(bookingId: string, driverId: string, expectedRevision: number): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'ARRIVED') return err(409, 'BAD_STATE', 'Only after you arrived at the pickup.');
    const a = await activeAssignmentFor(tx, bookingId, driverId);
    if (!a) return err(403, 'FORBIDDEN', 'Not your assignment.');
    const g = await tx.shareGroup.findFirst({ where: { OR: [{ activeHostBookingId: bookingId }, { activeGuestBookingId: bookingId }], status: 'ACCEPTED' } });
    if (!g) return err(409, 'NOT_SHARED', 'Only for a shared ride.');
    const w = await tx.waitingSession.findUnique({ where: { bookingId } });
    if (w && Date.now() - w.arrivedAt.getTime() < w.graceSeconds * 1000) return err(409, 'TOO_EARLY', 'Wait until the free waiting time is over.');
    const sharedPrice = g.hostBookingId === bookingId ? g.hostCents : g.guestCents;
    const fee = g.mode === 'PREBOOK' ? noShowFeeCents(sharedPrice) : null;
    await leaveShareTx(tx, bookingId, 'no-show', fee != null ? { noShowFeeCents: fee } : {});
    await tx.assignment.update({ where: { id: a.id }, data: { endedAt: new Date(), reason: 'no-show', activeBookingId: null, activeDriverId: null, activeVehicleId: null, queuedDriverId: null } });
    await afterLegEndedTx(tx, a);
    const u = await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'NO_SHOW', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'ARRIVED', afterStatus: 'CANCELED', reason: fee != null ? `no-show fee ${fee} cents` : 'no-show' } });
    await recordEvent(tx, { eventType: 'booking.canceled', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: u.revision, correlationId: bookingId, payload: { bookingId, status: 'CANCELED', actorType: 'DRIVER', reason: 'no-show', noShowFeeCents: fee } });
    await enqueuePassenger(tx, bookingId, 'Ride canceled — no-show', fee != null ? `The driver waited but you did not come. A no-show fee of €${(fee / 100).toFixed(2)} applies.` : 'The driver waited but you did not come.', { msg: fee != null ? { k: 'ride.noShowFee', p: { feeC: fee } } : { k: 'ride.noShow' } });
    return ok(u.status, u.revision, { noShowFeeCents: fee });
  });
}

/** The driver gives back the next ride he took while finishing a trip (2026-11-25, operator): it goes back to the
 *  search without him; the passenger is told another driver is being found. */
export async function driverReleaseNext(driverId: string): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    const q = await tx.assignment.findFirst({ where: { queuedDriverId: driverId } });
    if (!q) return err(404, 'NOT_FOUND', 'No next ride.');
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${q.bookingId} FOR UPDATE`;
    const again = await tx.assignment.findFirst({ where: { id: q.id, queuedDriverId: driverId } });
    if (!again) return err(409, 'CONFLICT', 'The ride changed. Refresh and retry.');
    await rematchBooking(tx, q.bookingId, driverId, 'driver gave back the next ride', 'DRIVER');
    const b = await tx.booking.findUnique({ where: { id: q.bookingId }, select: { status: true, revision: true } });
    return { ok: true, status: b!.status, revision: b!.revision };
  });
}
