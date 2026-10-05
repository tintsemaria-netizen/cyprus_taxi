import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { enqueueDriver } from '@/server/push';
import { recordEvent, driverPseudo } from '@/server/events';

type Tx = Prisma.TransactionClient;

// End the live commitment of a booking (if any). Used by driver release, passenger/staff cancel,
// manual assignment and the worker. Notifies the driver unless they are the one releasing.
export async function endPreAssignmentTx(tx: Tx, bookingId: string, status: 'RELEASED' | 'LAPSED' | 'CONVERTED', reason: string, opts: { notifyDriver?: string } = {}): Promise<{ driverId: string; pickupAt: Date } | null> {
  const pa = await tx.preAssignment.findUnique({ where: { activeBookingId: bookingId } });
  if (!pa) return null;
  await tx.preAssignment.update({ where: { id: pa.id }, data: { status, endedAt: new Date(), endReason: reason, activeBookingId: null } });
  await recordEvent(tx, { eventType: `preassign.${status.toLowerCase()}`, aggregateType: 'preassign', aggregateId: pa.id, aggregateVersion: 2, correlationId: bookingId, payload: { bookingId, driverPseudo: driverPseudo(pa.driverId), reason } });
  if (opts.notifyDriver) await enqueueDriver(tx, pa.driverId, 'Pre-booked ride update', opts.notifyDriver, { tag: `pre-${bookingId}` });
  return { driverId: pa.driverId, pickupAt: pa.pickupAt };
}

const MIN = 60_000;

// Drivers within the protection window of a live commitment get no new immediate offers.
export async function protectedDriverIds(now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.preAssignment.findMany({
    where: { status: 'COMMITTED', pickupAt: { lte: new Date(now.getTime() + config.dispatch.preassign.protectMinutes * MIN) } },
    select: { driverId: true },
  });
  return [...new Set(rows.map((r) => r.driverId))];
}
