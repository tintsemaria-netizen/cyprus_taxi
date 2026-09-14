import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { recordEvent, driverPseudo } from '@/server/events';

// Driver-reported settlement (Task 017 §5). Records the ACTUAL metered amount and optional
// payment-received confirmation as driver evidence — SEPARATE from the immutable Fare/quote, never
// overwriting an accepted upfront price. Corrections append a new revision (with a reason) instead
// of editing; the current settlement is the max revision for a booking. Only the driver whose
// assignment COMPLETED the trip may settle it. All amounts are integer minor units.

const MAX_CENTS = 100_000_00; // €100,000 sanity ceiling

export type SettlementResult =
  | { ok: true; settlement: SettlementView }
  | { ok: false; status: number; code: string; message: string };

export interface SettlementView {
  revision: number;
  reportedFinalCents: number;
  currency: string;
  paymentReceived: boolean;
  receivedAt: string | null;
  note: string | null;
  correctionReason: string | null;
  createdAt: string;
}

function view(s: {
  revision: number; reportedFinalCents: number; currency: string; paymentReceived: boolean;
  receivedAt: Date | null; note: string | null; correctionReason: string | null; createdAt: Date;
}): SettlementView {
  return {
    revision: s.revision, reportedFinalCents: s.reportedFinalCents, currency: s.currency,
    paymentReceived: s.paymentReceived, receivedAt: s.receivedAt?.toISOString() ?? null,
    note: s.note, correctionReason: s.correctionReason, createdAt: s.createdAt.toISOString(),
  };
}

const err = (status: number, code: string, message: string): SettlementResult => ({ ok: false, status, code, message });

export async function reportSettlement(
  driverId: string,
  bookingId: string,
  input: { reportedFinalCents: number; paymentReceived?: boolean; note?: string; correctionReason?: string; expectedRevision?: number },
): Promise<SettlementResult> {
  if (!Number.isInteger(input.reportedFinalCents) || input.reportedFinalCents < 0 || input.reportedFinalCents > MAX_CENTS) {
    return err(422, 'BAD_AMOUNT', 'Enter a valid metered amount.');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) return err(404, 'NOT_FOUND', 'Trip not found.');
    if (b.status !== 'COMPLETED') return err(409, 'NOT_COMPLETED', 'Settlement is only for a completed trip.');
    // Attribution: the completing assignment must belong to this driver.
    const asg = await tx.assignment.findFirst({ where: { bookingId, reason: 'completed' }, orderBy: { endedAt: 'desc' } });
    if (!asg || asg.driverId !== driverId) return err(403, 'NOT_YOUR_TRIP', 'Only the driver who completed this trip can settle it.');
    // An accepted upfront price is authoritative and must not be freely overwritten.
    if (b.priceType === 'UPFRONT_DYNAMIC') return err(409, 'UPFRONT_FIXED', 'This trip has an accepted upfront price; it cannot be re-settled.');

    const cur = await tx.driverSettlement.findFirst({ where: { bookingId }, orderBy: { revision: 'desc' } });
    const nextRev = (cur?.revision ?? 0) + 1;
    if (cur) {
      if (input.expectedRevision != null && input.expectedRevision !== cur.revision) return err(409, 'REVISION_CONFLICT', 'This settlement changed. Refresh and retry.');
      if (!input.correctionReason || input.correctionReason.trim().length < 3) return err(422, 'REASON_REQUIRED', 'A reason is required to correct a settlement.');
    }
    const fare = await tx.fare.findUnique({ where: { bookingId }, select: { currency: true } });
    const currency = fare?.currency ?? config.currency;
    const receivedAt = input.paymentReceived ? new Date() : null;

    const s = await tx.driverSettlement.create({
      data: {
        bookingId, driverId, assignmentId: asg.id, reportedFinalCents: input.reportedFinalCents, currency,
        paymentReceived: !!input.paymentReceived, receivedAt, note: input.note?.slice(0, 500) ?? null,
        revision: nextRev, correctionReason: cur ? (input.correctionReason?.slice(0, 300) ?? null) : null,
        createdByType: 'DRIVER', createdById: driverId,
      },
    });
    await tx.auditEvent.create({ data: { actorId: driverId, actorRole: 'DRIVER', action: nextRev > 1 ? 'SETTLEMENT_CORRECTED' : 'SETTLEMENT_REPORTED', target: bookingId, detail: `rev ${nextRev}` } });
    await recordEvent(tx, {
      eventType: nextRev > 1 ? 'settlement.corrected' : 'settlement.reported',
      aggregateType: 'settlement', aggregateId: bookingId, aggregateVersion: nextRev, correlationId: bookingId,
      payload: { bookingId, driverPseudo: driverPseudo(driverId), reportedFinalCents: input.reportedFinalCents, currency, paymentReceived: !!input.paymentReceived, revision: nextRev },
    });
    return { ok: true, settlement: view(s) };
  });
}

// Current settlement (max revision) for a booking, or null.
export async function currentSettlement(bookingId: string): Promise<SettlementView | null> {
  const s = await prisma.driverSettlement.findFirst({ where: { bookingId }, orderBy: { revision: 'desc' } });
  return s ? view(s) : null;
}

export async function settlementHistory(bookingId: string): Promise<SettlementView[]> {
  const rows = await prisma.driverSettlement.findMany({ where: { bookingId }, orderBy: { revision: 'asc' } });
  return rows.map(view);
}
