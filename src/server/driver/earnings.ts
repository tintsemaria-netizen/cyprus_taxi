import { nicosiaDayKey } from '@/lib/timezone';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { onlineSecondsInWindow } from './duty';
import { fareTotal, confirmedCents } from '@/lib/fare-total';

// Driver earnings (Task 017 §5) — financially truthful. "Recorded earnings" = completed trips with
// a KNOWN driver-attributable final amount (driver-reported settlement, or an accepted upfront
// Fare.finalCents). Trips with an unknown metered amount are counted as PENDING, never zero, and an
// estimate is NEVER summed as income. "Recorded collected" is only where payment was confirmed.
// Amounts are grouped by currency and never summed across currencies. Payment is to the driver —
// this is not platform revenue; there is no commission/wallet model.

export interface FinalResolution { finalCents: number | null; source: 'settlement' | 'upfront' | null; currency: string; collected: boolean }

// Launch fixes §6: the same rule as the receipt (src/lib/fare-total.ts) — a fixed price includes
// the recorded pickup waiting; a meter ride counts only the driver's entered taximeter amount.
export function resolveFinal(
  fare: { finalCents: number | null; currency: string; paymentStatus: string; waitingCents?: number; estimateCents?: number | null; priceType?: string } | null,
  settlement: { reportedFinalCents: number; currency: string; paymentReceived: boolean } | null,
): FinalResolution {
  const priceType = fare?.priceType ?? (fare?.finalCents != null ? 'REGULATED_FIXED' : 'REGULATED_METER_ESTIMATE');
  const t = fareTotal({
    priceType, completed: true, settlement,
    fare: fare ? { estimateCents: fare.estimateCents ?? null, waitingCents: fare.waitingCents ?? 0, finalCents: fare.finalCents, currency: fare.currency, paymentStatus: fare.paymentStatus } : null,
  });
  const cents = confirmedCents(t);
  if (cents == null) return { finalCents: null, source: null, currency: fare?.currency ?? config.currency, collected: false };
  return { finalCents: cents, source: t.source === 'meter' ? 'settlement' : 'upfront', currency: t.currency ?? config.currency, collected: t.state === 'PAID' };
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
    select: { bookingId: true, endedAt: true, booking: { select: { fare: { select: { finalCents: true, currency: true, paymentStatus: true, waitingCents: true, estimateCents: true, priceType: true } } } } },
  });
}

export async function earningsSummary(driverId: string, from: Date, to: Date): Promise<EarningsSummary> {
  const asgs = await completedAssignments(driverId, from, to);
  const settle = await currentSettlements(asgs.map((a) => a.bookingId));
  const byCur = new Map<string, CurrencyEarnings>();
  let pending = 0;
  for (const a of asgs) {
    const r = resolveFinal(a.booking.fare, settle.get(a.bookingId) ?? null);
    const c = byCur.get(r.currency) ?? { currency: r.currency, completedTrips: 0, recordedEarningsCents: 0, knownFinalTrips: 0, pendingFinalTrips: 0, collectedCents: 0 };
    c.completedTrips += 1;
    if (r.finalCents != null) {
      c.knownFinalTrips += 1;
      c.recordedEarningsCents += r.finalCents;
      if (r.collected) c.collectedCents += r.finalCents;
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
