import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { createAssignment } from '@/server/assignments';
import type { Candidate } from './eligibility';

export const OFFER_TTL_SEC = 20;

// Create an expiring offer to a reserved driver. The DB active* unique columns enforce
// one active offer per booking and per driver; a collision (race) returns null.
export async function createOffer(bookingId: string, c: Candidate): Promise<{ id: string } | null> {
  try {
    return await prisma.$transaction(async (tx) => {
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
      return { id: offer.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // lost the reservation race
    throw e;
  }
}

// Resolve an offer that timed out: mark EXPIRED, release the reservation, and remember
// the driver so we don't immediately re-offer the same request to them.
export async function expireOffer(offerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const o = await tx.driverOffer.findUnique({ where: { id: offerId } });
    if (!o || o.status !== 'OFFERED') return;
    await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'EXPIRED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
    await tx.dispatchJob.updateMany({ where: { bookingId: o.bookingId }, data: { triedDriverIds: { push: o.driverId } } });
  });
}

export type OfferResult =
  | { ok: true; status: string; revision: number }
  | { ok: false; status: number; code: string; message: string };

// Driver accepts an offer → atomically create the assignment (SYSTEM/DRIVER) and move the
// booking to ASSIGNED. Revalidates ownership, expiry (server time), booking state and
// capacity. Idempotent-safe: a late/duplicate accept on a resolved offer conflicts.
export async function acceptOffer(offerId: string, driverId: string): Promise<OfferResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const offer = await tx.driverOffer.findUnique({ where: { id: offerId } });
      if (!offer) return err(404, 'OFFER_NOT_FOUND', 'Offer not found.');
      if (offer.driverId !== driverId) return err(403, 'FORBIDDEN', 'Not your offer.');
      if (offer.status !== 'OFFERED') return err(409, 'OFFER_GONE', 'This offer is no longer available.');
      if (offer.expiresAt < new Date()) return err(409, 'OFFER_EXPIRED', 'This offer expired.');

      // Lock the booking row and re-validate.
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${offer.bookingId} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id: offer.bookingId } });
      if (!booking || booking.status !== 'SEARCHING') return err(409, 'BOOKING_GONE', 'This ride is no longer available.');

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !driver.onDuty) return err(409, 'DRIVER_INELIGIBLE', 'Driver no longer eligible.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driverId } })) return err(409, 'DRIVER_BUSY', 'You already have an active trip.');
      const vehicle = await tx.vehicle.findUnique({ where: { id: offer.vehicleId } });
      if (!vehicle || !vehicle.active || vehicle.vClass !== booking.vClass || vehicle.seats < booking.passengerCount) return err(409, 'VEHICLE_INELIGIBLE', 'Vehicle no longer eligible.');
      const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId, vehicleId: vehicle.id, endedAt: null } });
      if (!binding) return err(409, 'NOT_BOUND', 'Vehicle no longer bound.');

      await createAssignment(tx, booking, driver, vehicle, 'SYSTEM', 'auto-dispatch accept');
      await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'ACCEPTED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'OFFER_ACCEPTED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'SEARCHING', afterStatus: 'ASSIGNED' } });
      await tx.dispatchJob.deleteMany({ where: { bookingId: booking.id } });
      return { ok: true, status: updated.status, revision: updated.revision };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return err(409, 'DRIVER_BUSY', 'Capacity was just taken.');
    throw e;
  }
}

// Driver declines → release reservation, remember the driver, worker re-offers next.
export async function rejectOffer(offerId: string, driverId: string): Promise<OfferResult> {
  return prisma.$transaction(async (tx) => {
    const o = await tx.driverOffer.findUnique({ where: { id: offerId } });
    if (!o) return err(404, 'OFFER_NOT_FOUND', 'Offer not found.');
    if (o.driverId !== driverId) return err(403, 'FORBIDDEN', 'Not your offer.');
    if (o.status !== 'OFFERED') return { ok: true, status: o.status, revision: 0 }; // idempotent
    await tx.driverOffer.update({ where: { id: offerId }, data: { status: 'REJECTED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null } });
    await tx.dispatchJob.updateMany({ where: { bookingId: o.bookingId }, data: { triedDriverIds: { push: driverId } } });
    return { ok: true, status: 'REJECTED', revision: 0 };
  });
}

// The driver's current live offer (if any), with pickup summary for the offer card.
export async function getDriverActiveOffer(driverId: string) {
  const o = await prisma.driverOffer.findFirst({ where: { activeDriverId: driverId, status: 'OFFERED' } });
  if (!o || o.expiresAt < new Date()) return null;
  const b = await prisma.booking.findUnique({ where: { id: o.bookingId } });
  if (!b || b.status !== 'SEARCHING') return null;
  return {
    offerId: o.id,
    expiresAt: o.expiresAt.toISOString(),
    pickupEtaSec: o.pickupEtaSec,
    pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
    dropoff: { label: b.dropoffLabel },
    vClass: b.vClass,
    passengerCount: b.passengerCount,
    fareCents: b.fareCents,
  };
}

function err(status: number, code: string, message: string): OfferResult {
  return { ok: false, status, code, message };
}
