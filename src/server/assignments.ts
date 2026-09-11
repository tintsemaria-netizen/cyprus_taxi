import { prisma } from '@/lib/db';
import { Prisma, BookingStatus, Role } from '@prisma/client';
import { canTransition, isTerminal, PASSENGER_CANCELABLE } from '@/lib/status-machine';
import { computeFreshness } from '@/lib/freshness';

export type Actor = 'STAFF' | 'DRIVER' | 'PASSENGER';

export type OpResult =
  | { ok: true; revision: number; status: BookingStatus }
  | { ok: false; status: number; code: string; message: string };

// Business-rule failures THROW so the surrounding Prisma transaction rolls back.
// (Returning a value from a $transaction callback commits prior writes.)
class OpError extends Error {
  constructor(public httpStatus: number, public code: string, public detail: string) {
    super(detail);
  }
}
const conflict = (m = 'The booking changed. Refresh and retry.') => new OpError(409, 'CONFLICT', m);
const unprocessable = (code: string, m: string) => new OpError(422, code, m);
const notFound = (m = 'Booking not found.') => new OpError(404, 'NOT_FOUND', m);

// Run a mutation in a transaction and map thrown errors to an OpResult.
async function runOp(fn: (tx: Prisma.TransactionClient) => Promise<{ revision: number; status: BookingStatus }>): Promise<OpResult> {
  try {
    const r = await prisma.$transaction(fn);
    return { ok: true, revision: r.revision, status: r.status };
  } catch (e) {
    if (e instanceof OpError) return { ok: false, status: e.httpStatus, code: e.code, message: e.detail };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, status: 409, code: 'CONFLICT', message: 'Driver or vehicle was assigned concurrently.' };
    }
    throw e;
  }
}

// Lock the booking row FOR UPDATE, then read it fresh. This serializes competing
// mutations: a second transaction blocks on the lock until the first commits, then
// reads the updated revision and fails its optimistic check (avoids lost updates
// that a plain SELECT under READ COMMITTED would allow).
async function loadLockedBooking(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${id} FOR UPDATE`;
  return tx.booking.findUnique({ where: { id } });
}

// End the currently-active assignment for a booking and free that driver.
async function endActiveAssignment(tx: Prisma.TransactionClient, bookingId: string, reason: string) {
  const active = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
  if (active) {
    await tx.assignment.update({
      where: { id: active.id },
      data: { endedAt: new Date(), reason, activeBookingId: null, activeDriverId: null, activeVehicleId: null },
    });
    await tx.driver.update({ where: { id: active.driverId }, data: { available: true } });
  }
  return active;
}

// Validate a candidate driver+vehicle for a booking. Throws OpError on any problem.
// `excludeBookingId` lets a reassignment target the same driver/vehicle already on THIS booking.
async function validateCandidate(
  tx: Prisma.TransactionClient,
  booking: { id: string; vClass: 'COMFORT' | 'XL'; passengerCount: number },
  driverId: string,
  vehicleId: string,
  acknowledgeNoGps: boolean | undefined,
  excludeBookingId?: string,
) {
  const driver = await tx.driver.findUnique({ where: { id: driverId }, include: { location: true, user: true } });
  if (!driver || !driver.active || !driver.user.active) throw unprocessable('DRIVER_UNAVAILABLE', 'Driver is not active.');
  if (!driver.onDuty || !driver.available) throw unprocessable('DRIVER_UNAVAILABLE', 'Driver is not on duty and available.');
  const driverBusy = await tx.assignment.findFirst({
    where: { activeDriverId: driverId, ...(excludeBookingId ? { NOT: { activeBookingId: excludeBookingId } } : {}) },
  });
  if (driverBusy) throw conflict('Driver already has an active assignment.');

  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || !vehicle.active) throw unprocessable('VEHICLE_UNAVAILABLE', 'Vehicle is not active.');
  if (vehicle.vClass !== booking.vClass) throw unprocessable('CLASS_MISMATCH', 'Vehicle class does not match booking.');
  if (vehicle.seats < booking.passengerCount) throw unprocessable('CAPACITY', 'Vehicle does not have enough seats.');
  const vehicleBusy = await tx.assignment.findFirst({
    where: { activeVehicleId: vehicleId, ...(excludeBookingId ? { NOT: { activeBookingId: excludeBookingId } } : {}) },
  });
  if (vehicleBusy) throw conflict('Vehicle already has an active assignment.');

  const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId, vehicleId, endedAt: null } });
  if (!binding) throw unprocessable('NOT_BOUND', 'Driver is not currently bound to this vehicle.');

  // Assignment without fresh GPS requires an explicit acknowledgement.
  const loc = driver.location;
  const fresh = loc ? computeFreshness(loc.sampledAt, loc.receivedAt) === 'fresh' : false;
  if (!fresh && !acknowledgeNoGps) throw new OpError(409, 'GPS_WARNING', 'Driver has no fresh GPS. Re-submit with acknowledgeNoGps to proceed.');

  return { driver, vehicle };
}

async function createAssignment(
  tx: Prisma.TransactionClient,
  booking: { id: string },
  driver: { id: string; publicName: string; phone: string },
  vehicle: { id: string; plate: string; make: string; model: string; color: string; vClass: 'COMFORT' | 'XL' },
  actorId: string,
  reason?: string,
) {
  await tx.assignment.create({
    data: {
      bookingId: booking.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      driverPublicName: driver.publicName,
      driverPhone: driver.phone,
      vehiclePlate: vehicle.plate,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleColor: vehicle.color,
      vehicleClass: vehicle.vClass,
      actor: actorId,
      reason,
      activeBookingId: booking.id,
      activeDriverId: driver.id,
      activeVehicleId: vehicle.id,
    },
  });
  await tx.driver.update({ where: { id: driver.id }, data: { available: false } });
}

export async function assignBooking(params: {
  bookingId: string;
  driverId: string;
  vehicleId: string;
  expectedRevision: number;
  actorId: string;
  acknowledgeNoGps?: boolean;
}): Promise<OpResult> {
  return runOp(async (tx) => {
    const booking = await loadLockedBooking(tx, params.bookingId);
    if (!booking) throw notFound();
    if (booking.revision !== params.expectedRevision) throw conflict();
    if (booking.status !== 'REQUESTED') throw conflict('Booking is no longer awaiting assignment.');

    const { driver, vehicle } = await validateCandidate(tx, booking, params.driverId, params.vehicleId, params.acknowledgeNoGps);
    await createAssignment(tx, booking, driver, vehicle, params.actorId);

    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, type: 'ASSIGNED', actorType: 'STAFF', actorId: params.actorId, beforeStatus: 'REQUESTED', afterStatus: 'ASSIGNED' },
    });
    return { revision: updated.revision, status: updated.status };
  });
}

export async function unassignBooking(params: {
  bookingId: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
}): Promise<OpResult> {
  return runOp(async (tx) => {
    const booking = await loadLockedBooking(tx, params.bookingId);
    if (!booking) throw notFound();
    if (booking.revision !== params.expectedRevision) throw conflict();
    if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(booking.status)) throw conflict('Booking cannot be unassigned in its current state.');
    await endActiveAssignment(tx, booking.id, params.reason || 'unassigned');
    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'REQUESTED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, type: 'UNASSIGNED', actorType: 'STAFF', actorId: params.actorId, beforeStatus: booking.status, afterStatus: 'REQUESTED', reason: params.reason },
    });
    return { revision: updated.revision, status: updated.status };
  });
}

export async function reassignBooking(params: {
  bookingId: string;
  driverId: string;
  vehicleId: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
  acknowledgeNoGps?: boolean;
}): Promise<OpResult> {
  return runOp(async (tx) => {
    const booking = await loadLockedBooking(tx, params.bookingId);
    if (!booking) throw notFound();
    if (booking.revision !== params.expectedRevision) throw conflict();
    if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(booking.status)) throw conflict('Booking cannot be reassigned in its current state.');

    // Validate the NEW candidate BEFORE ending the old assignment. If this throws,
    // the transaction rolls back and the old assignment/driver/revision are preserved.
    const { driver, vehicle } = await validateCandidate(tx, booking, params.driverId, params.vehicleId, params.acknowledgeNoGps, booking.id);

    await endActiveAssignment(tx, booking.id, params.reason || 'reassigned');
    await createAssignment(tx, booking, driver, vehicle, params.actorId, params.reason);

    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'ASSIGNED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, type: 'REASSIGNED', actorType: 'STAFF', actorId: params.actorId, beforeStatus: booking.status, afterStatus: 'ASSIGNED', reason: params.reason },
    });
    return { revision: updated.revision, status: updated.status };
  });
}

export async function changeStatus(params: {
  bookingId: string;
  to: BookingStatus;
  expectedRevision: number;
  actor: Actor;
  actorId?: string;
  driverId?: string;
  reason?: string;
}): Promise<OpResult> {
  // ASSIGNED is reached only through the assignment endpoints, never a raw status change.
  if (params.to === 'ASSIGNED') return { ok: false, status: 422, code: 'USE_ASSIGN', message: 'Use the assignment endpoint to assign a driver.' };
  return runOp(async (tx) => {
    const booking = await loadLockedBooking(tx, params.bookingId);
    if (!booking) throw notFound();
    if (booking.revision !== params.expectedRevision) throw conflict();
    if (isTerminal(booking.status)) throw conflict('Booking is already in a terminal state.');

    if (params.actor === 'PASSENGER') {
      if (params.to !== 'CANCELED' || !PASSENGER_CANCELABLE.includes(booking.status)) {
        throw new OpError(403, 'FORBIDDEN', 'This cancellation is not allowed.');
      }
    }
    if (!canTransition(booking.status, params.to, params.actor)) {
      throw conflict(`Illegal transition ${booking.status} -> ${params.to}.`);
    }
    if (params.actor === 'DRIVER') {
      const active = await tx.assignment.findFirst({ where: { activeBookingId: booking.id } });
      if (!active || active.driverId !== params.driverId) throw new OpError(403, 'FORBIDDEN', 'Not your assignment.');
    }

    if (params.to === 'COMPLETED' || params.to === 'CANCELED') {
      await endActiveAssignment(tx, booking.id, params.to === 'COMPLETED' ? 'completed' : 'canceled');
    }

    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: params.to, revision: { increment: 1 } } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, type: `STATUS_${params.to}`, actorType: params.actor, actorId: params.actorId, beforeStatus: booking.status, afterStatus: params.to, reason: params.reason },
    });
    return { revision: updated.revision, status: updated.status };
  });
}

export async function terminateBooking(params: {
  bookingId: string;
  expectedRevision: number;
  actorId: string;
  reason: string;
}): Promise<OpResult> {
  if (!params.reason || params.reason.trim().length < 3) {
    return { ok: false, status: 422, code: 'REASON_REQUIRED', message: 'A reason is required to terminate an in-progress trip.' };
  }
  return runOp(async (tx) => {
    const booking = await loadLockedBooking(tx, params.bookingId);
    if (!booking) throw notFound();
    if (booking.revision !== params.expectedRevision) throw conflict();
    if (booking.status !== 'IN_PROGRESS') throw conflict('Only in-progress trips can be terminated.');
    await endActiveAssignment(tx, booking.id, 'terminated: ' + params.reason);
    const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELED', revision: { increment: 1 } } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, type: 'TERMINATED', actorType: 'STAFF', actorId: params.actorId, beforeStatus: 'IN_PROGRESS', afterStatus: 'CANCELED', reason: params.reason },
    });
    await tx.auditEvent.create({ data: { actorId: params.actorId, actorRole: Role.DISPATCHER, action: 'TERMINATE_TRIP', target: booking.id, detail: 'reason recorded' } });
    return { revision: updated.revision, status: updated.status };
  });
}
