import { prisma } from '@/lib/db';
import { onlineSecondsInWindow } from '@/server/driver/duty';

// Driver reliability for admins (2026-10 follow-up to Task 021). PostgreSQL is authoritative; every
// figure is a plain count over [from, to) with the definition shown on the page — no hidden scoring.
// Flags are review prompts for a human, never automatic sanctions (EU Platform Work Directive:
// significant decisions about drivers need human review).

export const GPS_LOSS_REASON = 'prolonged pre-pickup GPS loss';
export const LATE_RELEASE_REASON = 'driver released late';

export const FLAG_RULES = {
  lowAcceptance: { minOffers: 10, belowPct: 50 },
  missedOffers: { minOffers: 10, abovePct: 30 },
  lateReleases: { atLeast: 2 },
  lowRating: { minRatings: 5, below: 4.0 },
  preCancels: { atLeast: 3 },
  staleGpsOnline: { olderThanSec: 300 }, // on duty but no usable location → never matched
} as const;

export interface ReliabilityRow {
  driverId: string;
  name: string;
  eligibility: string;
  onlineHours: number;
  offers: { total: number; accepted: number; rejected: number; missed: number; acceptancePct: number | null; missedPct: number | null };
  trips: { completed: number; preCancels: number; gpsReleases: number };
  prebook: { taken: number; converted: number; lateReleases: number; releases: number; lapsed: number };
  rating: { average: number | null; count: number; low: number };
  // Live state right now (not windowed): explains "online but gets no offers".
  state: { onDuty: boolean; vehicle: string | null; gpsAgeSec: number | null };
  flags: string[];
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

export async function driverReliability(from: Date, to: Date): Promise<ReliabilityRow[]> {
  const drivers = await prisma.driver.findMany({
    where: { active: true },
    select: { id: true, publicName: true, eligibility: true, onDuty: true, location: { select: { sampledAt: true } }, bindings: { where: { endedAt: null }, select: { vehicle: { select: { plate: true, vClass: true, active: true } } } } },
    orderBy: { publicName: 'asc' },
  });
  const nowMs = Date.now();
  const range = { gte: from, lt: to };

  const [offers, completed, gpsReleases, preCancels, preAll, ratings] = await Promise.all([
    prisma.driverOffer.groupBy({ by: ['driverId', 'status'], where: { createdAt: range }, _count: { _all: true } }),
    prisma.assignment.groupBy({ by: ['driverId'], where: { reason: 'completed', endedAt: range }, _count: { _all: true } }),
    prisma.assignment.groupBy({ by: ['driverId'], where: { reason: GPS_LOSS_REASON, endedAt: range }, _count: { _all: true } }),
    prisma.bookingEvent.groupBy({ by: ['actorId'], where: { type: 'REMATCH', actorType: 'DRIVER', createdAt: range }, _count: { _all: true } }),
    prisma.preAssignment.findMany({ where: { committedAt: range }, select: { driverId: true, status: true, endReason: true } }),
    prisma.tripRating.findMany({ where: { createdAt: range }, select: { driverId: true, stars: true } }),
  ]);

  const rows: ReliabilityRow[] = [];
  for (const d of drivers) {
    const mine = offers.filter((o) => o.driverId === d.id);
    const count = (s: string) => mine.find((o) => o.status === s)?._count._all ?? 0;
    const accepted = count('ACCEPTED'), rejected = count('REJECTED'), missed = count('EXPIRED');
    // Offers withdrawn by the system (passenger cancelled, staff assigned) are not the driver's decision.
    const decided = accepted + rejected + missed;
    const pre = preAll.filter((p) => p.driverId === d.id);
    const rs = ratings.filter((r) => r.driverId === d.id);
    const row: ReliabilityRow = {
      driverId: d.id,
      name: d.publicName,
      eligibility: d.eligibility,
      onlineHours: Math.round(((await onlineSecondsInWindow(d.id, from, to)) / 3600) * 10) / 10,
      offers: { total: decided, accepted, rejected, missed, acceptancePct: pct(accepted, decided), missedPct: pct(missed, decided) },
      trips: {
        completed: completed.find((c) => c.driverId === d.id)?._count._all ?? 0,
        preCancels: preCancels.find((c) => c.actorId === d.id)?._count._all ?? 0,
        gpsReleases: gpsReleases.find((c) => c.driverId === d.id)?._count._all ?? 0,
      },
      prebook: {
        taken: pre.length,
        converted: pre.filter((p) => p.status === 'CONVERTED').length,
        lateReleases: pre.filter((p) => p.status === 'RELEASED' && p.endReason === LATE_RELEASE_REASON).length,
        releases: pre.filter((p) => p.status === 'RELEASED' && p.endReason?.startsWith('driver released')).length,
        lapsed: pre.filter((p) => p.status === 'LAPSED').length,
      },
      rating: {
        average: rs.length ? Math.round((rs.reduce((s, r) => s + r.stars, 0) / rs.length) * 10) / 10 : null,
        count: rs.length,
        low: rs.filter((r) => r.stars <= 2).length,
      },
      state: {
        onDuty: d.onDuty,
        vehicle: d.bindings[0]?.vehicle.active ? `${d.bindings[0].vehicle.plate} · ${d.bindings[0].vehicle.vClass}` : null,
        gpsAgeSec: d.location ? Math.round((nowMs - d.location.sampledAt.getTime()) / 1000) : null,
      },
      flags: [],
    };
    const f = FLAG_RULES;
    if (decided >= f.lowAcceptance.minOffers && (row.offers.acceptancePct ?? 100) < f.lowAcceptance.belowPct) row.flags.push('LOW_ACCEPTANCE');
    if (decided >= f.missedOffers.minOffers && (row.offers.missedPct ?? 0) > f.missedOffers.abovePct) row.flags.push('MISSED_OFFERS');
    if (row.prebook.lateReleases >= f.lateReleases.atLeast) row.flags.push('LATE_RELEASES');
    if (row.rating.count >= f.lowRating.minRatings && (row.rating.average ?? 5) < f.lowRating.below) row.flags.push('LOW_RATING');
    if (row.trips.preCancels >= f.preCancels.atLeast) row.flags.push('PRE_PICKUP_CANCELS');
    if (d.onDuty && !row.state.vehicle) row.flags.push('ONLINE_NO_VEHICLE');
    if (d.onDuty && (row.state.gpsAgeSec == null || row.state.gpsAgeSec > f.staleGpsOnline.olderThanSec)) row.flags.push('ONLINE_STALE_GPS');
    rows.push(row);
  }
  // Drivers needing attention first, then by name.
  return rows.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
}

export interface ReliabilityEvent { at: string; kind: string; detail: string; bookingRef: string | null }

// Recent reliability-relevant events for one driver (newest first), for the admin detail panel.
export async function driverReliabilityDetail(driverId: string, from: Date, to: Date): Promise<ReliabilityEvent[]> {
  const range = { gte: from, lt: to };
  const [pre, cancels, gps, low] = await Promise.all([
    prisma.preAssignment.findMany({ where: { driverId, committedAt: range, status: { in: ['RELEASED', 'LAPSED'] } }, include: { booking: { select: { reference: true } } }, orderBy: { endedAt: 'desc' }, take: 20 }),
    prisma.bookingEvent.findMany({ where: { type: 'REMATCH', actorType: 'DRIVER', actorId: driverId, createdAt: range }, include: { booking: { select: { reference: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.assignment.findMany({ where: { driverId, reason: GPS_LOSS_REASON, endedAt: range }, include: { booking: { select: { reference: true } } }, orderBy: { endedAt: 'desc' }, take: 20 }),
    prisma.tripRating.findMany({ where: { driverId, createdAt: range, stars: { lte: 2 } }, include: { booking: { select: { reference: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const ev: ReliabilityEvent[] = [
    ...pre.map((p) => ({ at: (p.endedAt ?? p.committedAt).toISOString(), kind: p.status === 'LAPSED' ? 'PREBOOK_LAPSED' : p.endReason === LATE_RELEASE_REASON ? 'PREBOOK_LATE_RELEASE' : 'PREBOOK_RELEASE', detail: p.endReason ?? '', bookingRef: p.booking.reference })),
    ...cancels.map((c) => ({ at: c.createdAt.toISOString(), kind: 'PRE_PICKUP_CANCEL', detail: c.reason ?? '', bookingRef: c.booking.reference })),
    ...gps.map((a) => ({ at: (a.endedAt ?? a.assignedAt).toISOString(), kind: 'GPS_RELEASE', detail: GPS_LOSS_REASON, bookingRef: a.booking.reference })),
    ...low.map((r) => ({ at: r.createdAt.toISOString(), kind: 'LOW_RATING', detail: `${r.stars}★${r.tags ? ' · ' + (JSON.parse(r.tags) as string[]).join(', ') : ''}${r.comment ? ' · “' + r.comment + '”' : ''}`, bookingRef: r.booking.reference })),
  ];
  return ev.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
}

export function reliabilityWindow(daysRaw: string | null): { from: Date; to: Date; days: number } {
  const days = [7, 30, 90].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86_400_000), to, days };
}
