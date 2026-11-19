import { config } from '@/lib/config';
import { chSelect, chDateTime } from './clickhouse';
import { prisma } from '@/lib/db';
import { fareTotal, confirmedCents } from '@/lib/fare-total';

// Canonical analytics queries (Task 016 §8) over ClickHouse domain_events. All queries dedup by
// eventId semantics (count(DISTINCT ...) / argMax by version), so at-least-once delivery and
// replays never change results. Inputs are dates + a boolean only — no user strings reach SQL,
// so there is no injection surface. Windows are half-open [from, to) in UTC. Metrics are defined
// to be financially/operationally truthful: unknown is never coerced to zero, estimates are
// never summed as income, and metrics we cannot yet compute return an explicit `unavailable`.

const MAX_WINDOW_DAYS = 366;

export interface AnalyticsFilter { from: Date; to: Date; includeTest: boolean }

export function normalizeWindow(fromRaw?: string, toRaw?: string): AnalyticsFilter {
  const now = Date.now();
  let to = toRaw ? new Date(toRaw) : new Date(now);
  let from = fromRaw ? new Date(fromRaw) : new Date(now - 30 * 86_400_000);
  if (Number.isNaN(to.getTime())) to = new Date(now);
  if (Number.isNaN(from.getTime())) from = new Date(now - 30 * 86_400_000);
  if (from >= to) from = new Date(to.getTime() - 86_400_000);
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) from = new Date(to.getTime() - MAX_WINDOW_DAYS * 86_400_000);
  return { from, to, includeTest: false };
}

// Common WHERE fragment: environment + window + test-data policy (default excludes synthetic).
function scope(f: AnalyticsFilter, extra = ''): string {
  const parts = [
    `environment = '${config.env}'`,
    `occurredAt >= toDateTime64('${chDateTime(f.from)}', 3)`,
    `occurredAt <  toDateTime64('${chDateTime(f.to)}', 3)`,
  ];
  if (!f.includeTest) parts.push('isTest = 0');
  return parts.join(' AND ') + (extra ? ` AND ${extra}` : '');
}
const DB = () => config.analytics.db;

export interface Overview {
  ridesRequested: number;
  ridesCompleted: number;
  ridesCanceled: number;
  ridesNoDriver: number;
  offers: { accepted: number; rejected: number; expired: number; acceptanceRate: number | null };
  dispatchLatencySec: { p50: number | null; p90: number | null };
  pickupWaitSec: { p50: number | null; p90: number | null };
}

export async function overview(f: AnalyticsFilter): Promise<Overview> {
  const bookings = await chSelect<{ eventType: string; n: string }>(
    `SELECT eventType, count(DISTINCT aggregateId) AS n FROM ${DB()}.domain_events
     WHERE ${scope(f, "eventType IN ('booking.requested','booking.scheduled','booking.completed','booking.canceled','booking.terminated','booking.no_driver')")}
     GROUP BY eventType`,
  );
  const bt: Record<string, number> = {};
  for (const r of bookings) bt[r.eventType] = Number(r.n);

  const offers = await chSelect<{ eventType: string; n: string }>(
    `SELECT eventType, count(DISTINCT aggregateId) AS n FROM ${DB()}.domain_events
     WHERE ${scope(f, "eventType IN ('offer.accepted','offer.rejected','offer.expired')")}
     GROUP BY eventType`,
  );
  const ot: Record<string, number> = {};
  for (const r of offers) ot[r.eventType] = Number(r.n);
  const accepted = ot['offer.accepted'] ?? 0, rejected = ot['offer.rejected'] ?? 0, expired = ot['offer.expired'] ?? 0;
  const resolved = accepted + rejected + expired;

  // Dispatch latency: booking.requested → booking.assigned, matched per booking.
  const disp = await chSelect<{ p50: number; p90: number }>(
    `SELECT quantile(0.5)(dt) AS p50, quantile(0.9)(dt) AS p90 FROM (
       SELECT aggregateId,
         dateDiff('second', minIf(occurredAt, eventType='booking.requested' OR eventType='booking.scheduled'),
                            minIf(occurredAt, eventType='booking.assigned')) AS dt
       FROM ${DB()}.domain_events WHERE ${scope(f, "eventType IN ('booking.requested','booking.scheduled','booking.assigned')")}
       GROUP BY aggregateId
       HAVING countIf(eventType='booking.assigned') > 0 AND dt >= 0)`,
  );
  const wait = await chSelect<{ p50: number; p90: number }>(
    `SELECT quantile(0.5)(dt) AS p50, quantile(0.9)(dt) AS p90 FROM (
       SELECT aggregateId,
         dateDiff('second', minIf(occurredAt, eventType='booking.assigned'),
                            minIf(occurredAt, eventType='booking.arrived')) AS dt
       FROM ${DB()}.domain_events WHERE ${scope(f, "eventType IN ('booking.assigned','booking.arrived')")}
       GROUP BY aggregateId
       HAVING countIf(eventType='booking.arrived') > 0 AND dt >= 0)`,
  );

  return {
    ridesRequested: (bt['booking.requested'] ?? 0) + (bt['booking.scheduled'] ?? 0),
    ridesCompleted: bt['booking.completed'] ?? 0,
    ridesCanceled: (bt['booking.canceled'] ?? 0) + (bt['booking.terminated'] ?? 0),
    ridesNoDriver: bt['booking.no_driver'] ?? 0,
    offers: { accepted, rejected, expired, acceptanceRate: resolved > 0 ? accepted / resolved : null },
    dispatchLatencySec: { p50: numOrNull(disp[0]?.p50), p90: numOrNull(disp[0]?.p90) },
    pickupWaitSec: { p50: numOrNull(wait[0]?.p50), p90: numOrNull(wait[0]?.p90) },
  };
}

export interface DailyPoint { day: string; requested: number; completed: number }
export async function daily(f: AnalyticsFilter): Promise<DailyPoint[]> {
  const rows = await chSelect<{ day: string; requested: string; completed: string }>(
    `SELECT toDate(occurredAt) AS day,
            count(DISTINCT if(eventType IN ('booking.requested','booking.scheduled'), aggregateId, NULL)) AS requested,
            count(DISTINCT if(eventType='booking.completed', aggregateId, NULL)) AS completed
     FROM ${DB()}.domain_events
     WHERE ${scope(f, "eventType IN ('booking.requested','booking.scheduled','booking.completed')")}
     GROUP BY day ORDER BY day`,
  );
  return rows.map((r) => ({ day: r.day, requested: Number(r.requested), completed: Number(r.completed) }));
}

export interface FareSummary {
  byCurrency: { currency: string; completedTrips: number; recordedFinalCents: number; knownFinalTrips: number; pendingFinalTrips: number }[];
  note: string;
}
export async function fareSummary(f: AnalyticsFilter): Promise<FareSummary> {
  // Launch fixes §6: money comes from the operational Postgres with the SAME rule as the receipt and
  // driver earnings (src/lib/fare-total.ts): the driver's latest taximeter amount for meter rides,
  // price + recorded waiting for fixed prices. The event stream only had the completion-time
  // Fare.finalCents (null for every meter ride) and never saw later amounts or corrections.
  const rows = await prisma.booking.findMany({
    where: {
      status: 'COMPLETED', ...(f.includeTest ? {} : { isTest: false }),
      events: { some: { type: 'COMPLETED', createdAt: { gte: f.from, lt: f.to } } },
    },
    select: { id: true, priceType: true, fare: { select: { estimateCents: true, waitingCents: true, finalCents: true, currency: true, paymentStatus: true, priceType: true } } },
    take: 20000,
  });
  const ids = rows.map((r) => r.id);
  const sets = ids.length ? await prisma.driverSettlement.findMany({ where: { bookingId: { in: ids } }, orderBy: { revision: 'asc' }, select: { bookingId: true, reportedFinalCents: true, currency: true, paymentReceived: true } }) : [];
  const settle = new Map(sets.map((s) => [s.bookingId, s]));
  const by = new Map<string, FareSummary['byCurrency'][number]>();
  for (const r of rows) {
    const t = fareTotal({ priceType: r.fare?.priceType ?? r.priceType, completed: true, fare: r.fare, settlement: settle.get(r.id) ?? null });
    const cur = t.currency ?? config.currency;
    const c = by.get(cur) ?? { currency: cur, completedTrips: 0, recordedFinalCents: 0, knownFinalTrips: 0, pendingFinalTrips: 0 };
    c.completedTrips += 1;
    const known = confirmedCents(t);
    if (known != null) { c.recordedFinalCents += known; c.knownFinalTrips += 1; } else c.pendingFinalTrips += 1;
    by.set(cur, c);
  }
  return {
    byCurrency: [...by.values()],
    note: 'Confirmed amounts only (driver-entered taximeter amount or accepted fixed price incl. recorded waiting), grouped by currency. Trips whose meter amount was not entered yet are counted as pending, not zero. Estimates are never counted as income.',
  };
}

// Driver online time from duty sessions (Task 017 events). Only CLOSED sessions
// (driver.offline) carry onlineSec, so sessions still open at query time are not yet counted —
// flagged rather than invented. Busy-vs-idle split is not computed here.
export interface DriverUtilization { available: true; onlineHours: number; activeDrivers: number; note: string }
export async function driverUtilization(f: AnalyticsFilter): Promise<DriverUtilization> {
  const rows = await chSelect<{ sec: string; drivers: string }>(
    `SELECT sum(toFloat64OrZero(JSONExtractRaw(payload, 'onlineSec'))) AS sec,
            count(DISTINCT JSONExtractString(payload, 'driverPseudo')) AS drivers
     FROM ${DB()}.domain_events WHERE ${scope(f, "eventType = 'driver.offline'")}`,
  );
  return {
    available: true,
    onlineHours: Math.round((Number(rows[0]?.sec ?? 0) / 3600) * 10) / 10,
    activeDrivers: Number(rows[0]?.drivers ?? 0),
    note: 'Completed duty sessions only; sessions still open are not yet included.',
  };
}

// Metrics we cannot yet compute honestly (no source events captured yet).
export const unavailable = {
  providerPerformance: { available: false, reason: 'No provider-call events captured yet.' },
};

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
