import type { Prisma } from '@prisma/client';
import { config } from '@/lib/config';

// The ONE way a booking enters or leaves autonomous search (2026-10-01 audit, Stage 1.8 / P2).
// The worker only progresses bookings that have a DispatchJob, so every path into SEARCHING must
// create one (otherwise the ride waits forever), and every path out of SEARCHING must withdraw the
// outstanding offer (otherwise the offered driver stays reserved and gets a push for a dead ride).
// Call inside the transaction that holds the booking row lock.

export function searchDeadline(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.dispatch.searchDeadlineSeconds * 1000);
}

export async function startSearchTx(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts: { deadlineAt?: Date; triedDriverIds?: string[] } = {},
): Promise<void> {
  await tx.dispatchJob.deleteMany({ where: { bookingId } });
  await tx.dispatchJob.create({
    data: { bookingId, deadlineAt: opts.deadlineAt ?? searchDeadline(), triedDriverIds: opts.triedDriverIds ?? [] },
  });
}

export async function stopSearchTx(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  await tx.driverOffer.updateMany({
    where: { bookingId, status: 'OFFERED' },
    data: { status: 'CANCELED', respondedAt: new Date(), activeBookingId: null, activeDriverId: null },
  });
  await tx.dispatchJob.deleteMany({ where: { bookingId } });
}
