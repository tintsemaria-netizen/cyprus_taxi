import { prisma } from '@/lib/db';
import { earningsSummary, earningsDaily } from '@/server/driver/earnings';
import { driverAnalytics, mondayOf } from '@/server/driver/analytics';
import { dutyToday } from '@/server/driver/duty';
import { driverWindow } from '@/server/driver/window';
import { listDriverTrips } from '@/server/driver/trips';
import { nicosiaDayKey, nicosiaMidnightUtc, startOfNicosiaDay } from '@/lib/timezone';

// Driver reports are ONE shared tool (2026-11-20, operator): the driver sees his own, the admin sees
// any driver's, and a fleet owner (next) will see his own drivers'. Every role's route only decides
// WHICH driver it may look at, then calls these — the figures and their shapes are identical.

/** Earnings for today / week / month (or a custom window): summary + per-day bars. */
export async function reportEarnings(driverId: string, url: URL) {
  const w = driverWindow(url.searchParams.get('range'), url.searchParams.get('from'), url.searchParams.get('to'));
  const [summary, daily] = await Promise.all([earningsSummary(driverId, w.from, w.to), earningsDaily(driverId, w.from, w.to)]);
  return { range: w.range, summary, daily };
}

/** Hours online, on orders and km — today and Monday → Sunday of this week. */
export async function reportDuty(driverId: string, now: Date = new Date()) {
  return dutyToday(driverId, startOfNicosiaDay(now), nicosiaMidnightUtc(mondayOf(nicosiaDayKey(now))), now);
}

/** Done / not done for a Cyprus day or the Monday–Sunday week around it. */
export async function reportAnalytics(driverId: string, url: URL) {
  const raw = url.searchParams.get('day');
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nicosiaDayKey(new Date());
  const week = url.searchParams.get('period') === 'week';
  return driverAnalytics(driverId, week ? mondayOf(day) : day, week ? 7 : 1);
}

/** CSV statement of one driver's trips in a window (amounts never converted between currencies). */
export async function reportStatementCsv(driverId: string, url: URL, label = 'driver'): Promise<Response> {
  const w = driverWindow(url.searchParams.get('range'), url.searchParams.get('from'), url.searchParams.get('to'));
  const rows: string[] = [];
  rows.push(['date_utc', 'reference', 'pickup', 'dropoff', 'class', 'passengers', 'status', 'fare_label', 'amount', 'currency', 'payment'].map(csvCell).join(','));
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await listDriverTrips(driverId, { from: w.from, to: w.to, limit: 50, cursor });
    for (const t of page.items) {
      rows.push([
        t.at, t.reference, t.pickupLabel, t.dropoffLabel, t.vClass, t.passengerCount, t.driverStatus,
        t.fare.label, t.fare.cents != null ? (t.fare.cents / 100).toFixed(2) : '', t.fare.currency, t.payment ?? '',
      ].map(csvCell).join(','));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && ++guard < 40); // cap ~2000 rows
  const generatedAt = new Date().toISOString();
  const body = `# IL-Y ${label} statement · range=${w.range} · days=Europe/Nicosia · timestamps=UTC · generated=${generatedAt}\n${rows.join('\n')}\n`;
  const safe = label.replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'driver';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="il-y-${safe}-${w.range}-${generatedAt.slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

export function csvCell(v: string | number | null): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formula injection
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface DriverFigures {
  driverId: string;
  onlineSec: number; onTripSec: number; km: number; onlineNow: boolean;
  weekSec: number; weekKm: number;
  done: number; notDone: number; earnedCents: number;
}

/** Today + this week at a glance, for a list of drivers (admin list, fleet owner's list). */
export async function driverFigures(driverIds: string[], now: Date = new Date()): Promise<DriverFigures[]> {
  const today = nicosiaDayKey(now);
  return Promise.all(driverIds.map(async (driverId) => {
    const [duty, an] = await Promise.all([reportDuty(driverId, now), driverAnalytics(driverId, today, 1)]);
    return {
      driverId,
      onlineSec: duty.onlineSec, onTripSec: duty.onTripSec, km: duty.km, onlineNow: duty.onlineNow,
      weekSec: duty.weekSec, weekKm: duty.weekKm,
      done: an.completed.count, notDone: an.driverCanceled.count + an.missedOffers.count, earnedCents: an.completed.cents,
    };
  }));
}

/** The driver ids a staff user may report on. ADMIN: any driver. */
export async function driverExists(driverId: string): Promise<boolean> {
  return !!(await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }));
}
