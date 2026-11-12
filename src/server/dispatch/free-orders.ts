import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { haversineMeters } from '@/lib/geo';
import { canWork } from '@/lib/eligibility-policy';
import { createAssignment } from '@/server/assignments';
import { enqueuePassenger } from '@/server/push';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';
import { protectedDriverIds } from './preassign-core';

// "Free orders" board (2026-11-12). A ride lands here ONLY after automatic dispatch has offered it
// to the free drivers nearby and nobody accepted before the search deadline — i.e. the booking is
// NO_DRIVER. Any eligible on-duty driver may then take it themselves. Rides stay listed for
// FREE_ORDER_WINDOW_MIN after search ended (the passenger may have given up after that), and
// disappear as soon as the passenger retries the search, cancels, or another driver takes it.
export const FREE_ORDER_WINDOW_MIN = 30;

export interface FreeOrder {
  bookingId: string;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  vClass: string;
  passengerCount: number;
  note: string | null;
  flightNumber: string | null;
  scheduledAt: string | null;
  fareCents: number | null;
  priceType: string | null;
  currency: string;
  waitingSince: string; // when the automatic search gave up
  distanceM: number | null; // straight-line from the driver's last fix to the pickup
}

export type ClaimResult =
  | { ok: true; status: string; revision: number }
  | { ok: false; status: number; code: string; message: string };

const err = (status: number, code: string, message: string): ClaimResult => ({ ok: false, status, code, message });

/** Free orders this driver's bound vehicle can serve, nearest first. No passenger name/phone. */
export async function listFreeOrders(driverId: string, now: Date = new Date()): Promise<FreeOrder[]> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
  });
  const vehicle = driver?.bindings[0]?.vehicle;
  if (!driver || !vehicle || !vehicle.active) return [];

  const rows = await prisma.booking.findMany({
    where: {
      status: 'NO_DRIVER',
      updatedAt: { gte: new Date(now.getTime() - FREE_ORDER_WINDOW_MIN * 60_000) },
      vClass: vehicle.vClass,
      passengerCount: { lte: vehicle.seats },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  const here = driver.location ? { lat: driver.location.lat, lng: driver.location.lng } : null;
  return rows
    .map((b) => ({
      bookingId: b.id,
      pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
      dropoff: { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel },
      vClass: b.vClass,
      passengerCount: b.passengerCount,
      note: b.note,
      flightNumber: b.flightNumber,
      scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
      fareCents: b.fareCents,
      priceType: b.priceType,
      currency: config.currency,
      waitingSince: b.updatedAt.toISOString(),
      distanceM: here ? Math.round(haversineMeters(here, { lat: b.pickupLat, lng: b.pickupLng })) : null,
    }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

/**
 * Driver takes a free order. Same guarantees as accepting an offer: the booking row is locked,
 * re-read and must still be NO_DRIVER (so two drivers racing for one ride → exactly one wins, and
 * a passenger retry/cancel in between wins over the claim); the driver and vehicle are re-checked;
 * the DB active-assignment uniques back it up. Like an accepted offer, taking a ride means heading
 * to the pickup: the booking goes ASSIGNED → EN_ROUTE in the same transaction.
 */
export async function claimFreeOrder(bookingId: string, driverId: string, now: Date = new Date()): Promise<ClaimResult> {
  // Drivers protected for an upcoming pre-booked ride can't take immediate work (same rule as offers).
  if ((await protectedDriverIds(now)).includes(driverId)) return err(409, 'DRIVER_PROTECTED', 'You have a pre-booked ride soon.');
  try {
    return await prisma.$transaction(async (tx): Promise<ClaimResult> => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return err(404, 'NOT_FOUND', 'Ride not found.');
      if (booking.status !== 'NO_DRIVER' || booking.updatedAt.getTime() < now.getTime() - FREE_ORDER_WINDOW_MIN * 60_000) {
        return err(409, 'ORDER_GONE', 'This ride is no longer available.');
      }

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !driver.onDuty || !canWork(driver)) return err(409, 'DRIVER_INELIGIBLE', 'Go online to take rides.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driverId } })) return err(409, 'DRIVER_BUSY', 'You already have an active trip.');
      if (await tx.driverOffer.findFirst({ where: { activeDriverId: driverId, status: 'OFFERED' } })) return err(409, 'DRIVER_BUSY', 'Answer your current offer first.');
      const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId, endedAt: null }, include: { vehicle: true } });
      const vehicle = binding?.vehicle;
      if (!vehicle || !vehicle.active) return err(409, 'NO_VEHICLE', 'No vehicle is assigned to you.');
      if (vehicle.vClass !== booking.vClass || vehicle.seats < booking.passengerCount) return err(409, 'VEHICLE_INELIGIBLE', 'Your vehicle does not fit this ride.');

      await createAssignment(tx, booking, driver, vehicle, 'SYSTEM', 'free-order claim');
      const assigned = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'FREE_ORDER_CLAIMED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'NO_DRIVER', afterStatus: 'ASSIGNED' } });
      await recordEvent(tx, {
        eventType: 'booking.assigned', aggregateType: 'booking', aggregateId: booking.id, aggregateVersion: assigned.revision,
        correlationId: booking.id,
        payload: { ...bookingEventPayload({ ...booking, status: 'ASSIGNED' }), driverPseudo: driverPseudo(driverId), source: 'free-order' },
      });
      const enRoute = await tx.booking.update({ where: { id: booking.id }, data: { status: 'EN_ROUTE', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'STATUS_EN_ROUTE', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'ASSIGNED', afterStatus: 'EN_ROUTE', reason: 'auto on claim' } });
      await recordEvent(tx, {
        eventType: 'booking.en_route', aggregateType: 'booking', aggregateId: booking.id, aggregateVersion: enRoute.revision,
        correlationId: booking.id,
        payload: { bookingId: booking.id, status: 'EN_ROUTE', actorType: 'DRIVER', reason: 'auto on claim' },
      });
      await enqueuePassenger(tx, booking.id, 'Driver found', 'A driver took your ride and is on the way — track them live.');
      return { ok: true, status: enRoute.status, revision: enRoute.revision };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return err(409, 'DRIVER_BUSY', 'Capacity was just taken.');
    throw e;
  }
}
