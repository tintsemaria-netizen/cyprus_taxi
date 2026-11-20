import { prisma } from '@/lib/db';
import type { OfferResult } from './offers';
import { startSearchTx } from './search';
import { noDriverRetryable } from '@/lib/ride-outcome';

// Passenger-initiated retry after NO_DRIVER: move the booking back to SEARCHING with a
// fresh DispatchJob (clean tried-list and deadline) so the worker starts a new search.
export async function researchBooking(bookingId: string, expectedRevision: number): Promise<OfferResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return errR(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    if (b.revision !== expectedRevision) return errR(409, 'REVISION_CONFLICT', 'This ride was updated — refresh.');
    if (b.status !== 'NO_DRIVER') return errR(409, 'NOT_RETRYABLE', 'This ride cannot be retried.');
    // An old failed order is not re-dispatched (2026-11-20): book a new ride instead.
    const since = (await tx.bookingEvent.findFirst({ where: { bookingId, afterStatus: 'NO_DRIVER' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt ?? b.updatedAt;
    if (!noDriverRetryable(b.status, since)) return errR(409, 'NOT_RETRYABLE', 'This ride did not take place — please book a new ride.');

    // Reset any stale job for this booking and start fresh.
    await startSearchTx(tx, bookingId);
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'SEARCHING', revision: { increment: 1 } } });
    await tx.bookingEvent.create({ data: { bookingId, type: 'RESEARCH', actorType: 'PASSENGER', beforeStatus: 'NO_DRIVER', afterStatus: 'SEARCHING' } });
    return { ok: true, status: updated.status, revision: updated.revision };
  });
}

function errR(status: number, code: string, message: string): OfferResult {
  return { ok: false, status, code, message };
}
