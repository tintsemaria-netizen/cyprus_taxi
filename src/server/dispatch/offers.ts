import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { createAssignment } from '@/server/assignments';
import { enqueueDriver, enqueuePassenger, offerBody } from '@/server/push';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';
import type { Candidate } from './eligibility';
import { canWork } from '@/lib/eligibility-policy';

export const OFFER_TTL_SEC = 20;

// Create an expiring offer to a reserved driver. The DB active* unique columns enforce
// one active offer per booking and per driver; a collision (race) returns null.
export async function createOffer(bookingId: string, c: Candidate): Promise<{ id: string } | null> {
  try {
    const res = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking || booking.status !== 'SEARCHING') return null;
      // Belt-and-braces: skip if the driver is already reserved elsewhere.
      const busy = await tx.assignment.findFirst({ where: { activeDriverId: c.driverId } });
      if (busy) return null;
      const offer = await tx.driverOffer.create({
        data: {
          bookingId, driverId: c.driverId, vehicleId: c.vehicleId,
          pickupEtaSec: c.etaSec, pickupDistanceM: Math.round(c.distanceMeters),
          status: 'OFFERED',
          expiresAt: new Date(Date.now() + OFFER_TTL_SEC * 1000),
          activeBookingId: bookingId, activeDriverId: c.driverId,
        },
      });
      await tx.bookingEvent.create({ data: { bookingId, type: 'OFFERED', actorType: 'SYSTEM' } });
      await recordEvent(tx, {
        eventType: 'offer.created', aggregateType: 'offer', aggregateId: offer.id, aggregateVersion: 1,
        correlationId: bookingId, occurredAt: offer.createdAt,
        payload: { bookingId, driverPseudo: driverPseudo(c.driverId), etaSec: c.etaSec ?? null, distanceM: Math.round(c.distanceMeters), expiresAt: offer.expiresAt.toISOString() },
      });
      // Notification job in the SAME transaction, bound to this exact offer (so a delayed
      // drain that finds the offer already resolved marks it SUPERSEDED, never delivers it).
      await enqueueDriver(tx, c.driverId, 'New ride offer', offerBody(booking.pickupLabel, c.etaSec), { tag: 'offer', offerId: offer.id });
      return { id: offer.id };
    });
    return res;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // lost the reservation race
    throw e;
  }
}

// Resolve an offer that timed out: mark EXPIRED, release the reservation, and remember
// the driver so we don't immediately re-offer the same request to them. Locks the booking
// row first so accept/reject/expire for one booking serialize on a single point (P0).
export async function expireOffer(offerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pre = await tx.driverOffer.findUnique({ where: { id: offerId }, select: { bookingId: true } });
    if (!pre) return;
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${pre.bookingId} FOR UPDATE`;
    const o = await tx.driverOffer.findUnique({ where: { id: offerId } }); // authoritative re-read under lock
    if (!o || o.status !== 'OFFERED') return;
    await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'EXPIRED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
    await tx.dispatchJob.updateMany({ where: { bookingId: o.bookingId }, data: { triedDriverIds: { push: o.driverId } } });
    await recordEvent(tx, {
      eventType: 'offer.expired', aggregateType: 'offer', aggregateId: offerId, aggregateVersion: 2,
      correlationId: o.bookingId,
      payload: { bookingId: o.bookingId, driverPseudo: driverPseudo(o.driverId), decision: 'expired', etaSec: o.pickupEtaSec ?? null, distanceM: o.pickupDistanceM ?? null },
    });
  });
}

export type OfferResult =
  | { ok: true; status: string; revision: number }
  | { ok: false; status: number; code: string; message: string };

// Driver accepts an offer → atomically create the assignment (SYSTEM/DRIVER) and move the
// booking to ASSIGNED. Revalidates ownership, expiry (server time), booking state and
// capacity. Idempotent-safe: a late/duplicate accept on a resolved offer conflicts.
export async function acceptOffer(offerId: string, driverId: string): Promise<OfferResult> {
  let acceptedBookingId: string | null = null;
  try {
    const result = await prisma.$transaction(async (tx): Promise<OfferResult> => {
      // Lock the booking row FIRST (single serialization point), then re-read the offer
      // authoritatively under that lock — so a concurrent reject/expire/cancel can't have
      // resolved it between our read and write.
      const pre = await tx.driverOffer.findUnique({ where: { id: offerId }, select: { bookingId: true } });
      if (!pre) return err(404, 'OFFER_NOT_FOUND', 'Offer not found.');
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${pre.bookingId} FOR UPDATE`;

      const offer = await tx.driverOffer.findUnique({ where: { id: offerId } });
      if (!offer) return err(404, 'OFFER_NOT_FOUND', 'Offer not found.');
      if (offer.driverId !== driverId) return err(403, 'FORBIDDEN', 'Not your offer.');
      if (offer.status !== 'OFFERED') return err(409, 'OFFER_GONE', 'This offer is no longer available.');
      if (offer.expiresAt < new Date()) return err(409, 'OFFER_EXPIRED', 'This offer expired.');

      const booking = await tx.booking.findUnique({ where: { id: offer.bookingId } });
      if (!booking || booking.status !== 'SEARCHING') return err(409, 'BOOKING_GONE', 'This ride is no longer available.');

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !driver.onDuty || !canWork(driver)) return err(409, 'DRIVER_INELIGIBLE', 'Driver no longer eligible.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driverId } })) return err(409, 'DRIVER_BUSY', 'You already have an active trip.');
      const vehicle = await tx.vehicle.findUnique({ where: { id: offer.vehicleId } });
      if (!vehicle || !vehicle.active || vehicle.vClass !== booking.vClass || vehicle.seats < booking.passengerCount) return err(409, 'VEHICLE_INELIGIBLE', 'Vehicle no longer eligible.');
      const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId, vehicleId: vehicle.id, endedAt: null } });
      if (!binding) return err(409, 'NOT_BOUND', 'Vehicle no longer bound.');

      await createAssignment(tx, booking, driver, vehicle, 'SYSTEM', 'auto-dispatch accept');
      await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'ACCEPTED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'OFFER_ACCEPTED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'SEARCHING', afterStatus: 'ASSIGNED' } });
      await recordEvent(tx, {
        eventType: 'offer.accepted', aggregateType: 'offer', aggregateId: offerId, aggregateVersion: 2,
        correlationId: booking.id,
        payload: { bookingId: booking.id, driverPseudo: driverPseudo(driverId), decision: 'accepted', etaSec: offer.pickupEtaSec ?? null, distanceM: offer.pickupDistanceM ?? null },
      });
      await recordEvent(tx, {
        eventType: 'booking.assigned', aggregateType: 'booking', aggregateId: booking.id, aggregateVersion: updated.revision,
        correlationId: booking.id,
        payload: { ...bookingEventPayload({ ...booking, status: 'ASSIGNED' }), driverPseudo: driverPseudo(driverId) },
      });
      await tx.dispatchJob.deleteMany({ where: { bookingId: booking.id } });
      await enqueuePassenger(tx, booking.id, 'Driver assigned', 'A driver is on the way — track them live.');
      acceptedBookingId = booking.id;
      return { ok: true, status: updated.status, revision: updated.revision };
    });
    void acceptedBookingId; // retained for potential callers/telemetry
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return err(409, 'DRIVER_BUSY', 'Capacity was just taken.');
    throw e;
  }
}

// Driver declines → release reservation, remember the driver, worker re-offers next.
export async function rejectOffer(offerId: string, driverId: string): Promise<OfferResult> {
  return prisma.$transaction(async (tx) => {
    const pre = await tx.driverOffer.findUnique({ where: { id: offerId } });
    if (!pre) return err(404, 'OFFER_NOT_FOUND', 'Offer not found.');
    if (pre.driverId !== driverId) return err(403, 'FORBIDDEN', 'Not your offer.');
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${pre.bookingId} FOR UPDATE`;
    const o = await tx.driverOffer.findUnique({ where: { id: offerId } }); // authoritative under lock
    if (!o || o.status !== 'OFFERED') return { ok: true, status: o?.status ?? 'GONE', revision: 0 }; // idempotent / lost the race
    await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'REJECTED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
    await tx.dispatchJob.updateMany({ where: { bookingId: o.bookingId }, data: { triedDriverIds: { push: driverId } } });
    await recordEvent(tx, {
      eventType: 'offer.rejected', aggregateType: 'offer', aggregateId: offerId, aggregateVersion: 2,
      correlationId: o.bookingId,
      payload: { bookingId: o.bookingId, driverPseudo: driverPseudo(driverId), decision: 'rejected', etaSec: o.pickupEtaSec ?? null, distanceM: o.pickupDistanceM ?? null },
    });
    return { ok: true, status: 'REJECTED', revision: 0 };
  });
}

// The driver's current live offer (if any), with pickup summary for the offer card.
export async function getDriverActiveOffer(driverId: string) {
  const o = await prisma.driverOffer.findFirst({ where: { activeDriverId: driverId, status: 'OFFERED' } });
  if (!o || o.expiresAt < new Date()) return null;
  const b = await prisma.booking.findUnique({ where: { id: o.bookingId } });
  if (!b || b.status !== 'SEARCHING') return null;
  // The offered driver gets the COMPLETE order data to decide: full fare breakdown + price type,
  // both endpoints, passenger name + count + note, schedule and pickup distance/ETA. Passenger
  // phone is revealed on acceptance (current-trip), not to every offered driver.
  return {
    offerId: o.id,
    expiresAt: o.expiresAt.toISOString(),
    pickupEtaSec: o.pickupEtaSec,
    pickupDistanceM: o.pickupDistanceM,
    pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
    dropoff: { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel },
    vClass: b.vClass,
    passengerCount: b.passengerCount,
    passengerName: b.passengerName,
    note: b.note,
    scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
    fareCents: b.fareCents,
    priceType: b.priceType,
    currency: config.currency,
    fareBreakdown: b.fareBreakdown ? safeParseLines(b.fareBreakdown) : null,
  };
}

function safeParseLines(s: string): { label: string; cents: number }[] | null {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.filter((x) => x && typeof x.label === 'string' && typeof x.cents === 'number').map((x) => ({ label: x.label, cents: x.cents }));
    return null;
  } catch { return null; }
}

function err(status: number, code: string, message: string): OfferResult {
  return { ok: false, status, code, message };
}
