import { isFixedPrice } from '@/lib/price-type';
import { prisma } from '@/lib/db';

// Passenger-facing ride receipt (Task 020 follow-on). Built from the IMMUTABLE Fare written once
// at completion — never recomputed. Under regulated metering the final amount is metered in the
// vehicle and paid to the driver, so finalCents is null and the receipt is honest about that
// (it shows the estimate + a clear note, not a fabricated total). Under an upfront price the
// committed amount is the final total. Driver/vehicle come from the snapshot captured on the
// completing assignment, so the receipt reflects who actually drove.

export interface ReceiptLine {
  label: string;
  cents: number;
}

export interface Receipt {
  reference: string;
  completedAt: string | null;
  pickup: string;
  dropoff: string;
  stop?: string | null;
  vClass: string;
  passengerCount: number;
  driver: { name: string; vehicle: string; plate: string } | null;
  fare: {
    priceType: string;
    currency: string;
    isUpfront: boolean;
    estimateCents: number | null;
    waitingCents: number;
    finalCents: number | null;
    /** What the passenger pays: final (upfront) or estimate + waiting — the driver's «Итого». */
    totalCents: number | null;
    lines: ReceiptLine[];
    note: string;
    paymentMethod: string;
    paymentStatus: string;
  };
  rating: { stars: number } | null;
  /** E-mailed copy (2026-11-17). null = never queued (no e-mail on the account). */
  email: { status: string; to: string; sentAt: string | null; canResend: boolean } | null;
  /** The account has an e-mail address (so «send to e-mail» can be offered). */
  canEmail: boolean;
}

function parseLines(s: string | null | undefined): ReceiptLine[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) {
      return v
        .filter((x) => x && typeof x.label === 'string' && typeof x.cents === 'number')
        .map((x) => ({ label: x.label as string, cents: x.cents as number }));
    }
  } catch {
    /* fall through */
  }
  return [];
}

export type ReceiptResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; status: number; code: string; message: string };

export async function passengerReceipt(bookingId: string, passengerId: string): Promise<ReceiptResult> {
  return buildReceipt(bookingId, passengerId);
}

/** Mask an e-mail for display: m•••@gmail.com */
export function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  if (!d) return e;
  return `${u.slice(0, 1)}•••@${d}`;
}

export const RECEIPT_RESEND_MAX = 3;

// Shared by the passenger API and the receipt e-mail. passengerId (when given) scopes the lookup.
export async function buildReceipt(bookingId: string, passengerId?: string): Promise<ReceiptResult> {
  const b = await prisma.booking.findFirst({
    where: passengerId ? { id: bookingId, passengerId } : { id: bookingId },
    select: {
      reference: true,
      status: true,
      pickupLabel: true,
      dropoffLabel: true,
      stopLabel: true,
      vClass: true,
      passengerCount: true,
      fareBreakdown: true,
      passengerId: true,
      fare: {
        select: {
          priceType: true,
          currency: true,
          estimateCents: true,
          waitingCents: true,
          finalCents: true,
          basis: true,
          paymentMethod: true,
          paymentStatus: true,
        },
      },
      rating: { select: { stars: true } },
    },
  });
  if (!b) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Ride not found.' };
  if (b.status !== 'COMPLETED' || !b.fare) {
    return { ok: false, status: 409, code: 'NO_RECEIPT', message: 'A receipt is available only after the ride is completed.' };
  }

  // Completion time = the COMPLETED booking event; and the driver/vehicle snapshot from the
  // assignment that actually completed the trip.
  const [completedEvent, completing, pax, mail] = await Promise.all([
    prisma.bookingEvent.findFirst({
      where: { bookingId, type: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.assignment.findFirst({
      where: { bookingId, reason: 'completed' },
      orderBy: { endedAt: 'desc' },
      select: { driverPublicName: true, vehicleMake: true, vehicleModel: true, vehicleColor: true, vehiclePlate: true },
    }),
    b.passengerId ? prisma.passenger.findUnique({ where: { id: b.passengerId }, select: { email: true } }) : Promise.resolve(null),
    prisma.receiptEmail.findUnique({ where: { bookingId }, select: { status: true, toEmail: true, sentAt: true, resendCount: true } }),
  ]);

  const isUpfront = isFixedPrice(b.fare.priceType);
  const note = isUpfront
    ? 'Accepted upfront price — this is the final amount.'
    : 'Estimated fare. The final regulated-meter amount is shown in the vehicle and paid to the driver.';

  return {
    ok: true,
    receipt: {
      reference: b.reference,
      completedAt: completedEvent?.createdAt.toISOString() ?? null,
      pickup: b.pickupLabel,
      dropoff: b.dropoffLabel,
      stop: b.stopLabel,
      vClass: b.vClass,
      passengerCount: b.passengerCount,
      driver: completing
        ? {
            name: completing.driverPublicName,
            vehicle: `${completing.vehicleColor} ${completing.vehicleMake} ${completing.vehicleModel}`.trim(),
            plate: completing.vehiclePlate,
          }
        : null,
      fare: {
        priceType: b.fare.priceType,
        currency: b.fare.currency,
        isUpfront,
        estimateCents: b.fare.estimateCents,
        waitingCents: b.fare.waitingCents,
        finalCents: b.fare.finalCents,
        totalCents: isUpfront ? (b.fare.finalCents != null ? b.fare.finalCents + b.fare.waitingCents : null) : b.fare.estimateCents != null ? b.fare.estimateCents + b.fare.waitingCents : null,
        lines: parseLines(b.fareBreakdown),
        note,
        paymentMethod: b.fare.paymentMethod,
        paymentStatus: b.fare.paymentStatus,
      },
      rating: b.rating ? { stars: b.rating.stars } : null,
      canEmail: !!pax?.email,
      email: mail ? { status: mail.status, to: maskEmail(mail.toEmail), sentAt: mail.sentAt?.toISOString() ?? null, canResend: mail.resendCount < RECEIPT_RESEND_MAX && mail.status !== 'PROCESSING' } : null,
    },
  };
}
