import { nicosiaDayKey } from '@/lib/timezone';
import { prisma } from '@/lib/db';
import { isFixedPrice } from '@/lib/price-type';
import { config } from '@/lib/config';
import { onlineSecondsInWindow } from './duty';
import { completedTotalCents, type CompletedFare } from '@/lib/fare-total';

// Driver earnings (Task 017 §5). Operator 2026-11-24: a ride's amount is fixed when the driver presses
// «Завершить» — the sum he was shown to collect, waiting included (src/lib/fare-total.ts) — and counts at
// once, the same as the passenger's receipt; a driver's later correction of a meter ride replaces it. "Recorded collected" is only where payment was confirmed.
// Amounts are grouped by currency and never summed across currencies. Payment is to the driver —
// this is not platform revenue; there is no commission/wallet model.

export interface FinalResolution { finalCents: number | null; source: 'settlement' | 'upfront' | 'completion' | null; currency: string; collected: boolean }

export function resolveFinal(
  fare: (CompletedFare & { currency: string; paymentStatus: string }) | null,
  settlement: { reportedFinalCents: number; currency: string; paymentReceived: boolean } | null,
): FinalResolution {
  // Operator 2026-11-24: the amount fixed at «Завершить» (with waiting) counts at once — the same as the
  // receipt (src/lib/fare-total.ts); a driver's later correction of a meter ride replaces it.
  if (settlement && fare && !isFixedPrice(fare.priceType)) return { finalCents: settlement.reportedFinalCents, source: 'settlement', currency: settlement.currency, collected: settlement.paymentReceived };
  const cents = fare ? completedTotalCents(fare) : null;
  if (fare && cents != null) return { finalCents: cents, source: isFixedPrice(fare.priceType) ? 'upfront' : 'completion', currency: fare.currency, collected: fare.paymentStatus === 'COLLECTED' || !!settlement?.paymentReceived };
  return { finalCents: null, source: null, currency: fare?.currency ?? config.currency, collected: false };
}

// Map bookingId → current (max-revision) settlement for a set of bookings (no N+1).
async function currentSettlements(bookingIds: string[]): Promise<Map<string, { reportedFinalCents: number; currency: string; paymentReceived: boolean }>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await prisma.driverSettlement.findMany({ where: { bookingId: { in: bookingIds } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true, currency: true, paymentReceived: true } });
  const m = new Map<string, { reportedFinalCents: number; currency: string; paymentReceived: boolean }>();
  for (const r of rows) m.set(r.bookingId, r); // ascending → last write wins = max revision
  return m;
}

export interface CurrencyEarnings {
  currency: string;
  completedTrips: number;
  recordedEarningsCents: number; // sum of KNOWN finals
  knownFinalTrips: number;
  pendingFinalTrips: number;     // unknown metered amount
  collectedCents: number;        // where payment confirmed
  cashCents: number;             // known finals paid in cash (Fare.paymentMethod CASH_*) — 2026-11-20
  cardCents: number;             // known finals paid by card (any CARD_* method; none at booking yet)
}

export interface EarningsSummary {
  window: { from: string; to: string; timezone: string };
  byCurrency: CurrencyEarnings[];
  completedTrips: number;
  pendingFinalTrips: number;
  onlineSeconds: number;
}

async function completedAssignments(driverId: string, from: Date, to: Date) {
  return prisma.assignment.findMany({
    where: { driverId, reason: 'completed', endedAt: { gte: from, lt: to } },
    select: { bookingId: true, endedAt: true, booking: { select: { fare: { select: { priceType: true, estimateCents: true, waitingCents: true, finalCents: true, currency: true, paymentStatus: true, paymentMethod: true } } } } },
  });
}

export async function earningsSummary(driverId: string, from: Date, to: Date): Promise<EarningsSummary> {
  const asgs = await completedAssignments(driverId, from, to);
  const settle = await currentSettlements(asgs.map((a) => a.bookingId));
  const byCur = new Map<string, CurrencyEarnings>();
  let pending = 0;
  for (const a of asgs) {
    const r = resolveFinal(a.booking.fare, settle.get(a.bookingId) ?? null);
    const c = byCur.get(r.currency) ?? { currency: r.currency, completedTrips: 0, recordedEarningsCents: 0, knownFinalTrips: 0, pendingFinalTrips: 0, collectedCents: 0, cashCents: 0, cardCents: 0 };
    c.completedTrips += 1;
    if (r.finalCents != null) {
      c.knownFinalTrips += 1;
      c.recordedEarningsCents += r.finalCents;
      if (r.collected) c.collectedCents += r.finalCents;
      if (/CARD/i.test(a.booking.fare?.paymentMethod ?? '')) c.cardCents += r.finalCents; else c.cashCents += r.finalCents;
    } else {
      c.pendingFinalTrips += 1;
      pending += 1;
    }
    byCur.set(r.currency, c);
  }
  return {
    window: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
    byCurrency: [...byCur.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    completedTrips: asgs.length,
    pendingFinalTrips: pending,
    onlineSeconds: await onlineSecondsInWindow(driverId, from, to),
  };
}

export interface DailyEarning { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }

export async function earningsDaily(driverId: string, from: Date, to: Date): Promise<DailyEarning[]> {
  const asgs = await completedAssignments(driverId, from, to);
  const settle = await currentSettlements(asgs.map((a) => a.bookingId));
  // key = day|currency
  const m = new Map<string, DailyEarning>();
  for (const a of asgs) {
    const r = resolveFinal(a.booking.fare, settle.get(a.bookingId) ?? null);
    const day = nicosiaDayKey(a.endedAt ?? new Date()); // Cyprus calendar day
    const key = `${day}|${r.currency}`;
    const d = m.get(key) ?? { day, currency: r.currency, recordedEarningsCents: 0, completedTrips: 0 };
    d.completedTrips += 1;
    if (r.finalCents != null) d.recordedEarningsCents += r.finalCents;
    m.set(key, d);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.currency.localeCompare(b.currency)));
}
