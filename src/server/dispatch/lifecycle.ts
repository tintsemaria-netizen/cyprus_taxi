import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { computeFreshness } from '@/lib/freshness';
import { haversineMeters } from '@/lib/geo';

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
const AIRPORTS = [
  { lat: 34.8751, lng: 33.6249 }, // Larnaca (LCA)
  { lat: 34.718, lng: 32.4857 }, // Paphos (PFO)
];
function isAirportPickup(lat: number, lng: number): boolean {
  return AIRPORTS.some((a) => haversineMeters({ lat, lng }, a) <= 2500);
}

async function activeAssignmentFor(tx: Prisma.TransactionClient, bookingId: string, driverId: string) {
  const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
  if (!a || a.driverId !== driverId) return null;
  return a;
}

// EN_ROUTE → ARRIVED. Requires the driver's own assignment, fresh GPS within the arrival
// radius of pickup (airports exempt), and opens a persisted waiting session.
export async function arriveAtPickup(bookingId: string, driverId: string, expectedRevision: number): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'EN_ROUTE') return err(409, 'BAD_STATE', 'You can only arrive while en route.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');

    if (!isAirportPickup(b.pickupLat, b.pickupLng)) {
      const loc = await tx.latestDriverLocation.findUnique({ where: { driverId } });
      if (!loc || computeFreshness(loc.sampledAt, loc.receivedAt) !== 'fresh') {
        return err(409, 'NO_FRESH_GPS', 'Fresh GPS is required to confirm arrival.');
      }
      const dist = haversineMeters({ lat: loc.lat, lng: loc.lng }, { lat: b.pickupLat, lng: b.pickupLng });
      if (dist > config.dispatch.arrivalRadiusMeters) return err(409, 'TOO_FAR', `You are ${Math.round(dist)} m from pickup. Get closer to confirm arrival.`);
    }

    const now = new Date();
    await tx.waitingSession.upsert({
      where: { bookingId },
      update: {}, // never reset an existing waiting session (refresh/retry safe)
      create: { bookingId, arrivedAt: now, graceSeconds: config.dispatch.waitingGraceSeconds, paidRateCentsPerMin: config.dispatch.waitingRateCentsPerMin },
    });
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'ARRIVED', arrivedAt: now, revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'ARRIVED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'EN_ROUTE', afterStatus: 'ARRIVED' } });
    return ok(updated.status, updated.revision);
  });
}

function computeAccrued(arrivedAt: Date, endedAt: Date, graceSeconds: number, rateCentsPerMin: number): number {
  const elapsed = Math.max(0, (endedAt.getTime() - arrivedAt.getTime()) / 1000);
  const paidSec = Math.max(0, elapsed - graceSeconds);
  return Math.round((paidSec / 60) * rateCentsPerMin);
}

// ARRIVED → IN_PROGRESS, gated by the passenger's start code. Finalizes waiting.
export async function startTrip(bookingId: string, driverId: string, expectedRevision: number, code: string): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'ARRIVED') return err(409, 'BAD_STATE', 'You can only start after arriving.');
    if (!(await activeAssignmentFor(tx, bookingId, driverId))) return err(403, 'FORBIDDEN', 'Not your assignment.');
    if (!b.startCode || code.trim() !== b.startCode) return err(422, 'BAD_START_CODE', 'Incorrect start code. Ask the passenger for their 4-digit code.');

    const now = new Date();
    const w = await tx.waitingSession.findUnique({ where: { bookingId } });
    if (w && !w.endedAt) {
      const accrued = computeAccrued(w.arrivedAt, now, w.graceSeconds, w.paidRateCentsPerMin);
      await tx.waitingSession.update({ where: { bookingId }, data: { endedAt: now, accruedCents: accrued } });
    }
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'IN_PROGRESS', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'TRIP_STARTED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'ARRIVED', afterStatus: 'IN_PROGRESS' } });
    return ok(updated.status, updated.revision);
  });
}

// IN_PROGRESS → COMPLETED. Writes the one immutable Fare record and frees the driver.
// Payment status stays PENDING (cash to driver is collected out of band, never auto-marked).
export async function completeTrip(bookingId: string, driverId: string, expectedRevision: number): Promise<LifeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return err(409, 'CONFLICT', 'The booking changed. Refresh and retry.');
    if (b.status !== 'IN_PROGRESS') return err(409, 'BAD_STATE', 'Only an in-progress trip can be completed.');
    const a = await activeAssignmentFor(tx, bookingId, driverId);
    if (!a) return err(403, 'FORBIDDEN', 'Not your assignment.');

    const w = await tx.waitingSession.findUnique({ where: { bookingId } });
    const waitingCents = w?.accruedCents ?? 0;
    const priceType = b.priceType ?? 'REGULATED_METER_ESTIMATE';
    const basis = {
      priceType,
      estimateCents: b.fareCents ?? null,
      waitingCents,
      note: 'Estimate; final regulated meter amount is settled with the driver.',
      breakdown: b.fareBreakdown ? safeParse(b.fareBreakdown) : null,
    };
    // Immutable: create only if none exists (idempotent complete).
    const existing = await tx.fare.findUnique({ where: { bookingId } });
    if (!existing) {
      await tx.fare.create({
        data: {
          bookingId, priceType, currency: config.currency,
          estimateCents: b.fareCents ?? null, waitingCents, finalCents: null,
          basis: JSON.stringify(basis), paymentMethod: 'CASH_TO_DRIVER', paymentStatus: 'PENDING',
        },
      });
    }
    // Free the driver + close the assignment.
    await tx.assignment.update({ where: { id: a.id }, data: { endedAt: new Date(), reason: 'completed', activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    await tx.driver.update({ where: { id: a.driverId }, data: { available: true } });
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'COMPLETED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'IN_PROGRESS', afterStatus: 'COMPLETED' } });
    return ok(updated.status, updated.revision);
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
  const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
  if (a) {
    await tx.assignment.update({ where: { id: a.id }, data: { endedAt: new Date(), reason, activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    await tx.driver.update({ where: { id: a.driverId }, data: { available: true } });
  }
  await tx.waitingSession.deleteMany({ where: { bookingId } });
  await tx.dispatchJob.deleteMany({ where: { bookingId } });
  await tx.dispatchJob.create({
    data: { bookingId, deadlineAt: new Date(Date.now() + config.dispatch.searchDeadlineSeconds * 1000), triedDriverIds: [excludeDriverId] },
  });
  await tx.booking.update({ where: { id: bookingId }, data: { status: 'SEARCHING', arrivedAt: null, revision: { increment: 1 } } });
  await tx.bookingEvent.create({ data: { bookingId, type: 'REMATCH', actorType, actorId: actorType === 'DRIVER' ? excludeDriverId : undefined, afterStatus: 'SEARCHING', reason } });
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
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
