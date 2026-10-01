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
    lines: ReceiptLine[];
    note: string;
    paymentMethod: string;
    paymentStatus: string;
  };
  rating: { stars: number } | null;
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
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, passengerId },
    select: {
      reference: true,
      status: true,
      pickupLabel: true,
      dropoffLabel: true,
      vClass: true,
      passengerCount: true,
      fareBreakdown: true,
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
  const [completedEvent, completing] = await Promise.all([
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
  ]);

  const isUpfront = b.fare.priceType === 'UPFRONT_DYNAMIC';
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
        lines: parseLines(b.fareBreakdown),
        note,
        paymentMethod: b.fare.paymentMethod,
        paymentStatus: b.fare.paymentStatus,
      },
      rating: b.rating ? { stars: b.rating.stars } : null,
    },
  };
}
