import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { haversineMeters } from '@/lib/geo';
import { canWork } from '@/lib/eligibility-policy';
import { createAssignment } from '@/server/assignments';
import { enqueuePassenger } from '@/server/push';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';
import { protectedDriverIds } from './preassign-core';
import { googleConfigured, googleRoute } from '@/server/google';

// "Free orders" board (2026-11-12). A ride lands here ONLY after automatic dispatch has offered it
// to every eligible free driver nearby without anyone accepting (or there was nobody to offer it
// to): the worker then "opens" its search job (DispatchJob.openedAt). The booking stays SEARCHING —
// the passenger keeps seeing "finding a driver" — and any on-duty driver whose car fits may take it
// for FREE_BOARD_SEC. After that the worker sets NO_DRIVER and the passenger re-orders.
// Class rule: a COMFORT ride fits COMFORT and XL cars; an XL ride fits XL cars only.
export const FREE_BOARD_SEC = 120;

export function vehicleFits(vehicle: { vClass: string; seats: number }, booking: { vClass: string; passengerCount: number }): boolean {
  const classOk = booking.vClass === 'XL' ? vehicle.vClass === 'XL' : vehicle.vClass === 'COMFORT' || vehicle.vClass === 'XL';
  return classOk && vehicle.seats >= booking.passengerCount;
}

export interface FreeOrder {
  bookingId: string;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  vClass: string;
  passengerName: string; // shown before taking; the phone only after taking
  passengerCount: number;
  note: string | null;
  flightNumber: string | null;
  scheduledAt: string | null;
  fareCents: number | null;
  priceType: string | null;
  currency: string;
  waitingSince: string; // when the ride was opened to all drivers
  expiresAt: string; // when it leaves the board (→ NO_DRIVER)
  expiresInMs: number; // remaining by the server clock (device clocks may be skewed)
  distanceM: number | null; // straight-line from the driver's last fix to the pickup
}

export type ClaimResult =
  | { ok: true; status: string; revision: number }
  | { ok: false; status: number; code: string; message: string };

const err = (status: number, code: string, message: string): ClaimResult => ({ ok: false, status, code, message });

/** Open rides this driver's bound vehicle can serve, nearest first. Name yes, phone no. */
export async function listFreeOrders(driverId: string, now: Date = new Date()): Promise<FreeOrder[]> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { location: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
  });
  const vehicle = driver?.bindings[0]?.vehicle;
  if (!driver || !vehicle || !vehicle.active) return [];

  const jobs = await prisma.dispatchJob.findMany({
    where: {
      openedAt: { not: null },
      deadlineAt: { gte: now },
      booking: { status: 'SEARCHING', vClass: { in: vehicle.vClass === 'XL' ? ['COMFORT', 'XL'] : ['COMFORT'] }, passengerCount: { lte: vehicle.seats } },
    },
    include: { booking: true },
    orderBy: { openedAt: 'asc' },
    take: 50,
  });
  const here = driver.location ? { lat: driver.location.lat, lng: driver.location.lng } : null;
  return jobs
    .map(({ booking: b, openedAt, deadlineAt }) => ({
      bookingId: b.id,
      pickup: { lat: b.pickupLat, lng: b.pickupLng, label: b.pickupLabel },
      dropoff: { lat: b.dropoffLat, lng: b.dropoffLng, label: b.dropoffLabel },
      vClass: b.vClass,
      passengerName: b.passengerName,
      passengerCount: b.passengerCount,
      note: b.note,
      flightNumber: b.flightNumber,
      scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
      fareCents: b.fareCents,
      priceType: b.priceType,
      currency: config.currency,
      waitingSince: openedAt!.toISOString(),
      expiresAt: deadlineAt.toISOString(),
      expiresInMs: Math.max(0, deadlineAt.getTime() - now.getTime()),
      distanceM: here ? Math.round(haversineMeters(here, { lat: b.pickupLat, lng: b.pickupLng })) : null,
    }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

export interface FreeOrderDetail extends FreeOrder {
  fareBreakdown: { label: string; cents: number }[] | null;
  pickupEtaSec: number | null; // by road when routed, else a straight-line estimate
  pickupDistanceM: number | null; // driving distance when routed, else straight-line
  roadRouted: boolean;
}

/**
 * Full details of one board ride for the driver to review before taking it — only while it is
 * on the board and fits the driver's car. Time/km to the client come from a road route from the
 * driver's last fix (short timeout; straight-line estimate if routing is unavailable). Still no
 * passenger phone: that is revealed after taking.
 */
export async function getFreeOrderDetail(bookingId: string, driverId: string, now: Date = new Date()): Promise<FreeOrderDetail | null> {
  const order = (await listFreeOrders(driverId, now)).find((o) => o.bookingId === bookingId);
  if (!order) return null;
  const [b, loc] = await Promise.all([
    prisma.booking.findUnique({ where: { id: bookingId }, select: { fareBreakdown: true } }),
    prisma.latestDriverLocation.findUnique({ where: { driverId } }),
  ]);
  let fareBreakdown: FreeOrderDetail['fareBreakdown'] = null;
  try {
    const v = b?.fareBreakdown ? JSON.parse(b.fareBreakdown) : null;
    if (Array.isArray(v)) fareBreakdown = v.filter((x) => x && typeof x.label === 'string' && typeof x.cents === 'number').map((x) => ({ label: x.label, cents: x.cents }));
  } catch { /* malformed snapshot → no breakdown */ }

  let pickupEtaSec: number | null = null;
  let pickupDistanceM = order.distanceM;
  let roadRouted = false;
  if (loc) {
    if (googleConfigured()) {
      try {
        const r = await googleRoute({ lat: loc.lat, lng: loc.lng }, order.pickup, undefined, { timeoutMs: 2500 });
        if (r) { pickupEtaSec = r.etaMinutes * 60; pickupDistanceM = Math.round(r.distanceKm * 1000); roadRouted = true; }
      } catch { /* fall back below */ }
    }
    if (!roadRouted && pickupDistanceM != null) pickupEtaSec = Math.round((pickupDistanceM / 1000 / 40) * 3600); // ~40 km/h
  }
  return { ...order, fareBreakdown, pickupEtaSec, pickupDistanceM, roadRouted };
}

/**
 * Driver takes a free order. Same guarantees as accepting an offer: the booking row is locked,
 * re-read and must still be SEARCHING with an open, unexpired board job (so two drivers racing for
 * one ride → exactly one wins, and a passenger cancel in between wins); driver and vehicle are re-checked;
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
      const job = await tx.dispatchJob.findUnique({ where: { bookingId } });
      if (booking.status !== 'SEARCHING' || !job?.openedAt || job.deadlineAt < now) return err(409, 'ORDER_GONE', 'This ride is no longer available.');
      if (await tx.driverOffer.findFirst({ where: { activeBookingId: bookingId } })) return err(409, 'ORDER_GONE', 'This ride is no longer available.');

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !driver.onDuty || !canWork(driver)) return err(409, 'DRIVER_INELIGIBLE', 'Go online to take rides.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driverId } })) return err(409, 'DRIVER_BUSY', 'You already have an active trip.');
      if (await tx.driverOffer.findFirst({ where: { activeDriverId: driverId, status: 'OFFERED' } })) return err(409, 'DRIVER_BUSY', 'Answer your current offer first.');
      const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId, endedAt: null }, include: { vehicle: true } });
      const vehicle = binding?.vehicle;
      if (!vehicle || !vehicle.active) return err(409, 'NO_VEHICLE', 'No vehicle is assigned to you.');
      if (!vehicleFits(vehicle, booking)) return err(409, 'VEHICLE_INELIGIBLE', 'Your vehicle does not fit this ride.');

      await createAssignment(tx, booking, driver, vehicle, 'SYSTEM', 'free-order claim');
      await tx.dispatchJob.deleteMany({ where: { bookingId } });
      const assigned = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: booking.id, type: 'FREE_ORDER_CLAIMED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'SEARCHING', afterStatus: 'ASSIGNED' } });
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
