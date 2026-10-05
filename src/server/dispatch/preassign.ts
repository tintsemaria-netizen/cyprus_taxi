import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { canWork } from '@/lib/eligibility-policy';
import { isAirportPoint } from '@/lib/airports';
import { createAssignment } from '@/server/assignments';
import { enqueueDriver, enqueuePassenger } from '@/server/push';
import { recordEvent, driverPseudo, bookingEventPayload } from '@/server/events';
import { stopSearchTx } from './search';
import { endPreAssignmentTx, protectedDriverIds } from './preassign-core';
export { endPreAssignmentTx, protectedDriverIds };

// Pre-assignment of scheduled rides (airport transfers etc.).
//
// Policy (Task 012 §4.4; our own policy, not a claim about any competitor's algorithm):
//  - Drivers see a board of upcoming scheduled rides that fit their bound vehicle and COMMIT to one.
//    The future is not predictable enough to auto-match hours ahead, so the driver chooses.
//  - A commitment never makes the driver busy now; they keep taking immediate rides. Only within
//    PREASSIGN_PROTECT_MINUTES of a commitment do they stop receiving new immediate offers.
//  - PREASSIGN_CONVERT_MINUTES before pickup the worker turns the commitment into a real Assignment
//    (SYSTEM actor) if the driver is on duty and free; it retries every tick until the normal
//    scheduled-search lead (DISPATCH_SCHEDULE_LEAD_MINUTES) and otherwise LAPSES the commitment, so
//    the ride falls back to automatic search. Both parties are told; nothing is silently dropped.
//  - Limits per driver: PREASSIGN_MAX_PER_DRIVER live commitments, PREASSIGN_MIN_GAP_MINUTES apart,
//    checked under the driver row lock (lock order everywhere: booking row, then driver row).

type Tx = Prisma.TransactionClient;
export type PAResult = { ok: true; status: string } | { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): PAResult => ({ ok: false, status, code, message });
const MIN = 60_000;

const timeLabel = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Nicosia', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);

async function boundVehicle(db: Tx | typeof prisma, driverId: string) {
  const b = await db.driverVehicleBinding.findFirst({ where: { driverId, endedAt: null }, include: { vehicle: true } });
  return b && b.vehicle.active ? b.vehicle : null;
}

export interface BoardItem {
  bookingId: string; reference: string; pickupAt: string; pickupLabel: string; dropoffLabel: string;
  vClass: string; passengerCount: number; fareCents: number | null; priceType: string | null;
  flightNumber: string | null; airport: boolean; conflict: boolean;
}

// The driver's view: rides they can still commit to, and their own live commitments.
export async function scheduledBoard(driverId: string, now: Date = new Date()) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  const vehicle = await boundVehicle(prisma, driverId);
  const mineRows = await prisma.preAssignment.findMany({
    where: { driverId, status: 'COMMITTED' },
    orderBy: { pickupAt: 'asc' },
    include: { booking: { select: { reference: true, pickupLabel: true, dropoffLabel: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, passengerCount: true, vClass: true, fareCents: true, priceType: true, flightNumber: true, note: true } } },
  });
  const mine = mineRows.map((p) => ({
    bookingId: p.bookingId, reference: p.booking.reference, pickupAt: p.pickupAt.toISOString(),
    pickupLabel: p.booking.pickupLabel, dropoffLabel: p.booking.dropoffLabel, vClass: p.booking.vClass,
    passengerCount: p.booking.passengerCount, fareCents: p.booking.fareCents, priceType: p.booking.priceType,
    flightNumber: p.booking.flightNumber, note: p.booking.note,
    airport: isAirportPoint(p.booking.pickupLat, p.booking.pickupLng) || isAirportPoint(p.booking.dropoffLat, p.booking.dropoffLng),
    canReleaseFreely: p.pickupAt.getTime() - now.getTime() > config.dispatch.preassign.lateReleaseMinutes * MIN,
  }));

  if (!driver || !canWork(driver) || !vehicle) {
    return { available: [] as BoardItem[], mine, blocked: !driver || !canWork(driver) ? 'NOT_ELIGIBLE' : 'NO_VEHICLE' };
  }
  const p = config.dispatch.preassign;
  const rows = await prisma.booking.findMany({
    where: {
      status: 'REQUESTED',
      scheduledAt: { gt: new Date(now.getTime() + (p.convertMinutes + 5) * MIN), lt: new Date(now.getTime() + p.horizonHours * 3600_000) },
      vClass: vehicle.vClass,
      passengerCount: { lte: vehicle.seats },
      preAssignments: { none: { status: 'COMMITTED' } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
    select: { id: true, reference: true, scheduledAt: true, pickupLabel: true, dropoffLabel: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true, vClass: true, passengerCount: true, fareCents: true, priceType: true, flightNumber: true },
  });
  const gap = p.minGapMinutes * MIN;
  const available: BoardItem[] = rows.map((b) => ({
    bookingId: b.id, reference: b.reference, pickupAt: b.scheduledAt!.toISOString(),
    pickupLabel: b.pickupLabel, dropoffLabel: b.dropoffLabel, vClass: b.vClass, passengerCount: b.passengerCount,
    fareCents: b.fareCents, priceType: b.priceType, flightNumber: b.flightNumber,
    airport: isAirportPoint(b.pickupLat, b.pickupLng) || isAirportPoint(b.dropoffLat, b.dropoffLng),
    conflict: mineRows.length >= p.maxPerDriver || mineRows.some((m) => Math.abs(m.pickupAt.getTime() - b.scheduledAt!.getTime()) < gap),
  }));
  return { available, mine, blocked: null as string | null };
}

export async function claimScheduled(driverId: string, bookingId: string, now: Date = new Date()): Promise<PAResult> {
  const p = config.dispatch.preassign;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${driverId} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) return fail(404, 'BOOKING_NOT_FOUND', 'Ride not found.');
      if (b.status !== 'REQUESTED' || !b.scheduledAt) return fail(409, 'BOOKING_GONE', 'This ride is no longer available.');
      const t = b.scheduledAt.getTime();
      if (t <= now.getTime() + (p.convertMinutes + 5) * MIN) return fail(409, 'TOO_CLOSE', 'This ride starts too soon to pre-book; it will be offered automatically.');
      if (t >= now.getTime() + p.horizonHours * 3600_000) return fail(409, 'TOO_FAR', 'This ride is too far ahead to pre-book yet.');
      if (await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } })) return fail(409, 'TAKEN', 'Another driver already took this ride.');

      const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { user: true } });
      if (!driver || !driver.active || !driver.user.active || !canWork(driver)) return fail(409, 'DRIVER_INELIGIBLE', 'Your account can’t take rides right now.');
      const vehicle = await boundVehicle(tx, driverId);
      if (!vehicle || vehicle.vClass !== b.vClass || vehicle.seats < b.passengerCount) return fail(409, 'VEHICLE_INELIGIBLE', 'Your vehicle doesn’t fit this ride.');

      const mine = await tx.preAssignment.findMany({ where: { driverId, status: 'COMMITTED' }, select: { pickupAt: true } });
      if (mine.length >= p.maxPerDriver) return fail(409, 'LIMIT', `You can hold at most ${p.maxPerDriver} pre-booked rides.`);
      if (mine.some((m) => Math.abs(m.pickupAt.getTime() - t) < p.minGapMinutes * MIN)) return fail(409, 'OVERLAP', 'This ride is too close to another ride you pre-booked.');

      const pa = await tx.preAssignment.create({ data: { bookingId, driverId, vehicleId: vehicle.id, pickupAt: b.scheduledAt, activeBookingId: bookingId } });
      await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGNED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED' } });
      await recordEvent(tx, { eventType: 'preassign.committed', aggregateType: 'preassign', aggregateId: pa.id, aggregateVersion: 1, correlationId: bookingId, payload: { bookingId, driverPseudo: driverPseudo(driverId), minutesAhead: Math.round((t - now.getTime()) / MIN) } });
      await enqueuePassenger(tx, bookingId, 'Driver confirmed', `${driver.publicName.split(' ')[0]} will pick you up ${timeLabel(b.scheduledAt)}.`);
      return { ok: true, status: 'COMMITTED' };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return fail(409, 'TAKEN', 'Another driver already took this ride.');
    throw e;
  }
}

export async function releaseScheduled(driverId: string, bookingId: string, now: Date = new Date()): Promise<PAResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
    if (!pa || pa.driverId !== driverId) return fail(404, 'NOT_FOUND', 'You have no pre-booking for this ride.');
    const late = pa.pickupAt.getTime() - now.getTime() < config.dispatch.preassign.lateReleaseMinutes * MIN;
    await endPreAssignmentTx(tx, bookingId, 'RELEASED', late ? 'driver released late' : 'driver released');
    await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_RELEASED', actorType: 'DRIVER', actorId: driverId, beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED', reason: late ? 'late release' : null } });
    await enqueuePassenger(tx, bookingId, 'Driver change', 'Your confirmed driver can no longer make it. We will find you another driver automatically before pickup.');
    return { ok: true, status: late ? 'RELEASED_LATE' : 'RELEASED' };
  });
}

// ---- worker step (runs every dispatch tick, BEFORE scheduled promotion) ----
export async function runPreassignments(now: Date = new Date()): Promise<{ reminded: number; converted: number; lapsed: number }> {
  const p = config.dispatch.preassign;
  let reminded = 0, converted = 0, lapsed = 0;

  // 1) One reminder per commitment.
  const due = await prisma.preAssignment.findMany({ where: { status: 'COMMITTED', remindedAt: null, pickupAt: { lte: new Date(now.getTime() + p.remindMinutes * MIN) } }, include: { booking: { select: { pickupLabel: true, flightNumber: true } } }, take: 50 });
  for (const r of due) {
    const upd = await prisma.preAssignment.updateMany({ where: { id: r.id, remindedAt: null, status: 'COMMITTED' }, data: { remindedAt: now } });
    if (upd.count !== 1) continue; // another worker reminded already (fencing)
    await enqueueDriver(prisma, r.driverId, 'Upcoming pre-booked ride', `Pickup ${timeLabel(r.pickupAt)} at ${r.booking.pickupLabel}${r.booking.flightNumber ? ` · flight ${r.booking.flightNumber}` : ''}. Go online in time.`, { tag: `pre-${r.bookingId}` });
    reminded++;
  }

  // 2) Convert (or lapse) commitments inside the conversion window.
  const window = await prisma.preAssignment.findMany({ where: { status: 'COMMITTED', pickupAt: { lte: new Date(now.getTime() + p.convertMinutes * MIN) } }, select: { bookingId: true }, take: 25 });
  for (const w of window) {
    const r = await convertOne(w.bookingId, now);
    if (r === 'converted') converted++;
    if (r === 'lapsed') lapsed++;
  }
  return { reminded, converted, lapsed };
}

async function convertOne(bookingId: string, now: Date): Promise<'converted' | 'lapsed' | 'waiting' | 'gone'> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
    if (!pa) return 'gone';
    await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${pa.driverId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.status !== 'REQUESTED') {
      await endPreAssignmentTx(tx, bookingId, 'RELEASED', 'booking no longer awaiting a driver');
      return 'gone';
    }
    const lapse = async (why: string, passengerMsg: string, driverMsg: string) => {
      await endPreAssignmentTx(tx, bookingId, 'LAPSED', why, { notifyDriver: driverMsg });
      await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_LAPSED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'REQUESTED', reason: why } });
      await enqueuePassenger(tx, bookingId, 'Finding you a driver', passengerMsg);
      return 'lapsed' as const;
    };

    const driver = await tx.driver.findUnique({ where: { id: pa.driverId }, include: { user: true } });
    const vehicle = await tx.vehicle.findUnique({ where: { id: pa.vehicleId } });
    const binding = vehicle ? await tx.driverVehicleBinding.findFirst({ where: { driverId: pa.driverId, vehicleId: vehicle.id, endedAt: null } }) : null;
    if (!driver || !driver.active || !driver.user.active || !canWork(driver) || !vehicle || !vehicle.active || !binding || vehicle.vClass !== b.vClass || vehicle.seats < b.passengerCount) {
      return lapse('driver or vehicle no longer eligible', 'Your confirmed driver is no longer available. We are finding you another driver automatically.', 'Your pre-booked ride was released: your account or vehicle is not eligible right now.');
    }
    const busy = !driver.onDuty
      || !!(await tx.assignment.findFirst({ where: { activeDriverId: pa.driverId }, select: { id: true } }))
      || !!(await tx.driverOffer.findFirst({ where: { activeDriverId: pa.driverId }, select: { id: true } }));
    if (busy) {
      // Keep trying until the normal scheduled-search lead; then fall back to automatic search.
      if (pa.pickupAt.getTime() - now.getTime() > config.dispatch.scheduleLeadMinutes * MIN) return 'waiting';
      return lapse(driver.onDuty ? 'driver busy at conversion' : 'driver offline at conversion',
        'Your confirmed driver could not make it in time. We are finding you another driver automatically.',
        driver.onDuty ? 'Your pre-booked ride was handed to automatic dispatch because you were still on another trip.' : 'Your pre-booked ride was handed to automatic dispatch because you were offline.');
    }

    await createAssignment(tx, b, driver, vehicle, 'SYSTEM', 'pre-assignment conversion');
    await stopSearchTx(tx, bookingId);
    const u = await tx.booking.update({ where: { id: bookingId }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'PREASSIGN_CONVERTED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'ASSIGNED' } });
    await recordEvent(tx, { eventType: 'booking.assigned', aggregateType: 'booking', aggregateId: bookingId, aggregateVersion: u.revision, correlationId: bookingId, payload: { ...bookingEventPayload({ ...b, status: 'ASSIGNED' }), driverPseudo: driverPseudo(pa.driverId), preassigned: true } });
    await endPreAssignmentTx(tx, bookingId, 'CONVERTED', 'converted to assignment');
    await enqueuePassenger(tx, bookingId, 'Driver assigned', `${driver.publicName.split(' ')[0]} is assigned to your ride — track them live.`);
    await enqueueDriver(tx, pa.driverId, 'Pre-booked ride is now active', `Pickup ${timeLabel(pa.pickupAt)} at ${b.pickupLabel}. Head to the pickup in time.`, { tag: `pre-${bookingId}` });
    return 'converted';
  });
}
