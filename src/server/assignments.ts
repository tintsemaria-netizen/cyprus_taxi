import { prisma } from '@/lib/db';
import { Prisma, BookingStatus, Role } from '@prisma/client';
import { canTransition, isTerminal, PASSENGER_CANCELABLE } from '@/lib/status-machine';
import { computeFreshness } from '@/lib/freshness';

export type Actor = 'STAFF' | 'DRIVER' | 'PASSENGER';

export type OpResult =
  | { ok: true; revision: number; status: BookingStatus }
  | { ok: false; status: number; code: string; message: string };

function conflict(message = 'The booking changed. Refresh and retry.'): OpResult {
  return { ok: false, status: 409, code: 'CONFLICT', message };
}
function unprocessable(code: string, message: string): OpResult {
  return { ok: false, status: 422, code, message };
}

// End the currently-active assignment for a booking inside a transaction and
// free the driver. Nulling the active* columns releases the DB uniqueness locks.
async function endActiveAssignment(
  tx: Prisma.TransactionClient,
  bookingId: string,
  reason: string,
) {
  const active = await tx.assignment.findFirst({
    where: { activeBookingId: bookingId },
  });
  if (active) {
    await tx.assignment.update({
      where: { id: active.id },
      data: { endedAt: new Date(), reason, activeBookingId: null, activeDriverId: null, activeVehicleId: null },
    });
    // Driver becomes available again; their live location relationship ends
    // because the passenger feed keys off the active assignment.
    await tx.driver.update({ where: { id: active.driverId }, data: { available: true } });
  }
  return active;
}

export async function assignBooking(params: {
  bookingId: string;
  driverId: string;
  vehicleId: string;
  expectedRevision: number;
  actorId: string;
  acknowledgeNoGps?: boolean;
}): Promise<OpResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
      if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
      if (booking.revision !== params.expectedRevision) return conflict();
      if (booking.status !== 'REQUESTED') return conflict('Booking is no longer awaiting assignment.');

      const driver = await tx.driver.findUnique({
        where: { id: params.driverId },
        include: { location: true, user: true },
      });
      if (!driver || !driver.active || !driver.user.active) return unprocessable('DRIVER_UNAVAILABLE', 'Driver is not active.');
      if (!driver.onDuty || !driver.available) return unprocessable('DRIVER_UNAVAILABLE', 'Driver is not on duty and available.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driver.id } })) return conflict('Driver already has an active assignment.');

      const vehicle = await tx.vehicle.findUnique({ where: { id: params.vehicleId } });
      if (!vehicle || !vehicle.active) return unprocessable('VEHICLE_UNAVAILABLE', 'Vehicle is not active.');
      if (vehicle.vClass !== booking.vClass) return unprocessable('CLASS_MISMATCH', 'Vehicle class does not match booking.');
      if (vehicle.seats < booking.passengerCount) return unprocessable('CAPACITY', 'Vehicle does not have enough seats.');
      if (await tx.assignment.findFirst({ where: { activeVehicleId: vehicle.id } })) return conflict('Vehicle already has an active assignment.');

      // Driver must be bound to this vehicle currently.
      const binding = await tx.driverVehicleBinding.findFirst({
        where: { driverId: driver.id, vehicleId: vehicle.id, endedAt: null },
      });
      if (!binding) return unprocessable('NOT_BOUND', 'Driver is not currently bound to this vehicle.');

      // GPS warning gate: assignment without fresh GPS requires acknowledgement.
      const loc = driver.location;
      const fresh = loc ? computeFreshness(loc.sampledAt, loc.receivedAt) === 'fresh' : false;
      if (!fresh && !params.acknowledgeNoGps) {
        return { ok: false, status: 409, code: 'GPS_WARNING', message: 'Driver has no fresh GPS. Re-submit with acknowledgeNoGps to proceed.' };
      }

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
          actor: params.actorId,
          activeBookingId: booking.id,
          activeDriverId: driver.id,
          activeVehicleId: vehicle.id,
        },
      });
      await tx.driver.update({ where: { id: driver.id }, data: { available: false } });
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'ASSIGNED', revision: { increment: 1 } },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId: booking.id,
          type: 'ASSIGNED',
          actorType: 'STAFF',
          actorId: params.actorId,
          beforeStatus: 'REQUESTED',
          afterStatus: 'ASSIGNED',
        },
      });
      return { ok: true, revision: updated.revision, status: updated.status };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Lost the race for driver/vehicle active-uniqueness.
      return conflict('Driver or vehicle was assigned concurrently.');
    }
    throw e;
  }
}

export async function unassignBooking(params: {
  bookingId: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
}): Promise<OpResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
    if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
    if (booking.revision !== params.expectedRevision) return conflict();
    if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(booking.status)) {
      return conflict('Booking cannot be unassigned in its current state.');
    }
    await endActiveAssignment(tx, booking.id, params.reason || 'unassigned');
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'REQUESTED', revision: { increment: 1 } },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'UNASSIGNED',
        actorType: 'STAFF',
        actorId: params.actorId,
        beforeStatus: booking.status,
        afterStatus: 'REQUESTED',
        reason: params.reason,
      },
    });
    return { ok: true, revision: updated.revision, status: updated.status };
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
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
      if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
      if (booking.revision !== params.expectedRevision) return conflict();
      if (!['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(booking.status)) {
        return conflict('Booking cannot be reassigned in its current state.');
      }
      await endActiveAssignment(tx, booking.id, params.reason || 'reassigned');

      const driver = await tx.driver.findUnique({ where: { id: params.driverId }, include: { location: true, user: true } });
      if (!driver || !driver.active || !driver.user.active) return unprocessable('DRIVER_UNAVAILABLE', 'Driver is not active.');
      if (!driver.onDuty) return unprocessable('DRIVER_UNAVAILABLE', 'Driver is not on duty.');
      if (await tx.assignment.findFirst({ where: { activeDriverId: driver.id } })) return conflict('Driver already has an active assignment.');
      const vehicle = await tx.vehicle.findUnique({ where: { id: params.vehicleId } });
      if (!vehicle || !vehicle.active) return unprocessable('VEHICLE_UNAVAILABLE', 'Vehicle is not active.');
      if (vehicle.vClass !== booking.vClass) return unprocessable('CLASS_MISMATCH', 'Vehicle class does not match booking.');
      if (vehicle.seats < booking.passengerCount) return unprocessable('CAPACITY', 'Vehicle does not have enough seats.');
      if (await tx.assignment.findFirst({ where: { activeVehicleId: vehicle.id } })) return conflict('Vehicle already has an active assignment.');
      const binding = await tx.driverVehicleBinding.findFirst({ where: { driverId: driver.id, vehicleId: vehicle.id, endedAt: null } });
      if (!binding) return unprocessable('NOT_BOUND', 'Driver is not currently bound to this vehicle.');

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
          actor: params.actorId,
          reason: params.reason,
          activeBookingId: booking.id,
          activeDriverId: driver.id,
          activeVehicleId: vehicle.id,
        },
      });
      await tx.driver.update({ where: { id: driver.id }, data: { available: false } });
      // Reset operational status to ASSIGNED per SPEC §4.
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'ASSIGNED', revision: { increment: 1 } },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId: booking.id,
          type: 'REASSIGNED',
          actorType: 'STAFF',
          actorId: params.actorId,
          beforeStatus: booking.status,
          afterStatus: 'ASSIGNED',
          reason: params.reason,
        },
      });
      return { ok: true, revision: updated.revision, status: updated.status };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Driver or vehicle was assigned concurrently.');
    }
    throw e;
  }
}

export async function changeStatus(params: {
  bookingId: string;
  to: BookingStatus;
  expectedRevision: number;
  actor: Actor;
  actorId?: string;
  driverId?: string; // for DRIVER actor authorization
  reason?: string;
}): Promise<OpResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
    if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
    if (booking.revision !== params.expectedRevision) return conflict();
    if (isTerminal(booking.status)) return conflict('Booking is already in a terminal state.');

    if (params.actor === 'PASSENGER') {
      if (params.to !== 'CANCELED' || !PASSENGER_CANCELABLE.includes(booking.status)) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'This cancellation is not allowed.' };
      }
    }
    if (!canTransition(booking.status, params.to, params.actor)) {
      return conflict(`Illegal transition ${booking.status} -> ${params.to}.`);
    }

    // DRIVER may only act on their own active assignment.
    if (params.actor === 'DRIVER') {
      const active = await tx.assignment.findFirst({ where: { activeBookingId: booking.id } });
      if (!active || active.driverId !== params.driverId) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Not your assignment.' };
      }
    }

    // Terminal transitions end the assignment and free the driver.
    if (params.to === 'COMPLETED' || params.to === 'CANCELED') {
      await endActiveAssignment(tx, booking.id, params.to === 'COMPLETED' ? 'completed' : 'canceled');
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: params.to, revision: { increment: 1 } },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: `STATUS_${params.to}`,
        actorType: params.actor,
        actorId: params.actorId,
        beforeStatus: booking.status,
        afterStatus: params.to,
        reason: params.reason,
      },
    });
    return { ok: true, revision: updated.revision, status: updated.status };
  });
}

// Exceptional termination of an IN_PROGRESS trip (staff only, reason required).
export async function terminateBooking(params: {
  bookingId: string;
  expectedRevision: number;
  actorId: string;
  reason: string;
}): Promise<OpResult> {
  if (!params.reason || params.reason.trim().length < 3) {
    return unprocessable('REASON_REQUIRED', 'A reason is required to terminate an in-progress trip.');
  }
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: params.bookingId } });
    if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
    if (booking.revision !== params.expectedRevision) return conflict();
    if (booking.status !== 'IN_PROGRESS') return conflict('Only in-progress trips can be terminated.');
    await endActiveAssignment(tx, booking.id, 'terminated: ' + params.reason);
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELED', revision: { increment: 1 } },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'TERMINATED',
        actorType: 'STAFF',
        actorId: params.actorId,
        beforeStatus: 'IN_PROGRESS',
        afterStatus: 'CANCELED',
        reason: params.reason,
      },
    });
    await tx.auditEvent.create({
      data: { actorId: params.actorId, actorRole: Role.DISPATCHER, action: 'TERMINATE_TRIP', target: booking.id, detail: 'reason recorded' },
    });
    return { ok: true, revision: updated.revision, status: updated.status };
  });
}
