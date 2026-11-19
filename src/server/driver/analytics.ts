import { prisma } from '@/lib/db';
import { nicosiaDayKey, nicosiaMidnightUtc } from '@/lib/timezone';
import { resolveFinal } from './earnings';

// Driver analytics (2026-11-19, operator): for one Cyprus day or a week — what the driver did and
// earned, and what slipped away (rides he cancelled, rides the passenger cancelled / no-show,
// offers he declined or let expire) with the money those rides were worth. «Worth» = the ride's
// final amount if known, else its price estimate (never counted as income).

export interface AnalyticsBucket { count: number; cents: number }
export interface AnalyticsDay {
  day: string;
  completed: AnalyticsBucket; pendingFinal: number;
  driverCanceled: AnalyticsBucket; passengerCanceled: AnalyticsBucket; missedOffers: AnalyticsBucket;
}
export interface AnalyticsItem { at: string; from: string; to: string; cents: number | null; kind: 'done' | 'canceled' | 'missed' }
export interface DriverAnalytics extends AnalyticsDay { from: string; to: string; days: AnalyticsDay[]; doneItems: AnalyticsItem[]; notDoneItems: AnalyticsItem[] }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const empty = (day: string): AnalyticsDay => ({ day, completed: { count: 0, cents: 0 }, pendingFinal: 0, driverCanceled: { count: 0, cents: 0 }, passengerCanceled: { count: 0, cents: 0 }, missedOffers: { count: 0, cents: 0 } });
const add = (b: AnalyticsBucket, cents: number | null | undefined) => { b.count += 1; b.cents += cents ?? 0; };

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week that holds `day` (Cyprus calendar). */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

export async function driverAnalytics(driverId: string, fromDay: string, days: 1 | 7): Promise<DriverAnalytics> {
  if (!DAY_RE.test(fromDay)) throw new Error('bad day');
  const toDay = addDays(fromDay, days);
  const from = nicosiaMidnightUtc(fromDay), to = nicosiaMidnightUtc(toDay);
  const byDay = new Map<string, AnalyticsDay>();
  for (let i = 0; i < days; i++) { const k = addDays(fromDay, i); byDay.set(k, empty(k)); }
  const bucket = (at: Date) => byDay.get(nicosiaDayKey(at));

  const fareSel = { select: { finalCents: true, estimateCents: true, currency: true, paymentStatus: true, waitingCents: true, priceType: true } } as const;
  // Rides this driver was on that ended in the window.
  const asgs = await prisma.assignment.findMany({
    where: { driverId, endedAt: { gte: from, lt: to } },
    select: { bookingId: true, endedAt: true, reason: true, booking: { select: { status: true, pickupLabel: true, dropoffLabel: true, fare: fareSel } } },
  });
  const ids = asgs.map((a) => a.bookingId);
  const settlements = ids.length ? await prisma.driverSettlement.findMany({ where: { bookingId: { in: ids } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true, currency: true, paymentReceived: true } }) : [];
  const settle = new Map(settlements.map((s) => [s.bookingId, s]));
  // Who ended a ride before pickup: the driver's own «cancel» is a REMATCH event by this driver.
  const driverRematch = ids.length ? await prisma.bookingEvent.findMany({ where: { bookingId: { in: ids }, type: 'REMATCH', actorType: 'DRIVER', actorId: driverId, createdAt: { gte: from, lt: to } }, select: { bookingId: true } }) : [];
  const byDriver = new Set(driverRematch.map((e) => e.bookingId));

  const doneItems: AnalyticsItem[] = [], notDoneItems: AnalyticsItem[] = [];
  for (const a of asgs) {
    const d = a.endedAt && bucket(a.endedAt); if (!d) continue;
    const item = (kind: AnalyticsItem['kind'], cents: number | null): AnalyticsItem => ({ at: a.endedAt!.toISOString(), from: a.booking.pickupLabel, to: a.booking.dropoffLabel, cents, kind });
    const worth = a.booking.fare?.finalCents ?? a.booking.fare?.estimateCents ?? null;
    if (a.reason === 'completed') {
      const r = resolveFinal(a.booking.fare, settle.get(a.bookingId) ?? null);
      d.completed.count += 1;
      if (r.finalCents != null) d.completed.cents += r.finalCents; else d.pendingFinal += 1;
      doneItems.push(item('done', r.finalCents));
    } else if (byDriver.has(a.bookingId)) { add(d.driverCanceled, worth); notDoneItems.push(item('canceled', worth)); }
    else if (a.reason === 'no-show' || a.reason === 'canceled' || a.booking.status === 'CANCELED') add(d.passengerCanceled, worth);
    // anything else (system re-match, staff re-assignment) is not the driver's doing and not shown
  }

  // Offers he said «no» to or let run out.
  const offers = await prisma.driverOffer.findMany({
    where: { driverId, status: { in: ['REJECTED', 'EXPIRED'] }, createdAt: { gte: from, lt: to } },
    select: { createdAt: true, booking: { select: { pickupLabel: true, dropoffLabel: true, fare: fareSel } } },
  });
  for (const o of offers) {
    const d = bucket(o.createdAt); if (!d) continue;
    const worth = o.booking.fare?.finalCents ?? o.booking.fare?.estimateCents ?? null;
    add(d.missedOffers, worth);
    notDoneItems.push({ at: o.createdAt.toISOString(), from: o.booking.pickupLabel, to: o.booking.dropoffLabel, cents: worth, kind: 'missed' });
  }

  const list = [...byDay.values()];
  const total = empty(fromDay);
  for (const d of list) {
    for (const k of ['completed', 'driverCanceled', 'passengerCanceled', 'missedOffers'] as const) { total[k].count += d[k].count; total[k].cents += d[k].cents; }
    total.pendingFinal += d.pendingFinal;
  }
  const byTime = (x: AnalyticsItem, y: AnalyticsItem) => (x.at < y.at ? 1 : -1); // newest first
  return { ...total, from: fromDay, to: addDays(toDay, -1), days: list, doneItems: doneItems.sort(byTime), notDoneItems: notDoneItems.sort(byTime) };
}
