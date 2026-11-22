import { prisma } from '@/lib/db';
import { enqueueDriver } from '@/server/push';
import { generateStartCode } from '@/server/dispatch/lifecycle';

// Optional trip-start code (2026-11-16). A ride no longer has a code by default; the passenger
// can switch one on (or off) on their tracking screen until the trip starts. While a code is
// set, the driver must enter it to start the trip (see startTrip); with none, the driver starts
// with one tap. The assigned driver is notified so their start bar shows / hides the code field.
const OPEN = ['SEARCHING', 'NO_DRIVER', 'REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED'];

export type StartCodeResult = { ok: true; startCode: string | null } | { ok: false; status: number; code: string; message: string };

export async function passengerSetStartCode(bookingId: string, enabled: boolean): Promise<StartCodeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true, startCode: true } });
    if (!b) return { ok: false as const, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
    if (!OPEN.includes(b.status)) return { ok: false as const, status: 409, code: 'BAD_STATE', message: 'The trip has already started.' };
    if (enabled === !!b.startCode) return { ok: true as const, startCode: b.startCode ?? null };
    const startCode = enabled ? generateStartCode() : null;
    await tx.booking.update({ where: { id: bookingId }, data: { startCode, revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: enabled ? 'START_CODE_ON' : 'START_CODE_OFF', actorType: 'PASSENGER', actorId: 'tracking', beforeStatus: b.status, afterStatus: b.status } });
    const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
    if (a?.activeDriverId) {
      // No push (operator, 2026-11-22): the driver cannot start without the passenger anyway, and the
      // trip screen asks for the code when it is needed.
    }
    return { ok: true as const, startCode };
  });
}
