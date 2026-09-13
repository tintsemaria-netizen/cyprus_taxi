import { prisma } from '@/lib/db';
import type { OfferResult } from './offers';

// Passenger-initiated retry after NO_DRIVER: move the booking back to SEARCHING with a
// fresh DispatchJob (clean tried-list and deadline) so the worker starts a new search.
export async function researchBooking(bookingId: string, expectedRevision: number): Promise<OfferResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return errR(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return errR(409, 'REVISION_CONFLICT', 'This ride was updated — refresh.');
    if (b.status !== 'NO_DRIVER') return errR(409, 'NOT_RETRYABLE', 'This ride cannot be retried.');

    // Reset any stale job for this booking and start fresh.
    await tx.dispatchJob.deleteMany({ where: { bookingId } });
    await tx.dispatchJob.create({ data: { bookingId, deadlineAt: new Date(Date.now() + 180 * 1000) } });
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'SEARCHING', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'RESEARCH', actorType: 'PASSENGER', beforeStatus: 'NO_DRIVER', afterStatus: 'SEARCHING' } });
    return { ok: true, status: updated.status, revision: updated.revision };
  });
}

function errR(status: number, code: string, message: string): OfferResult {
  return { ok: false, status, code, message };
}
