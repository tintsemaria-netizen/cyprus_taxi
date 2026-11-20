import { Prisma } from '@prisma/client';
import { haversineMeters } from '@/lib/geo';
import { nicosiaDayKey } from '@/lib/timezone';
import { prisma } from '@/lib/db';
import { recordEvent, driverPseudo } from '@/server/events';

// Driver on/off-duty sessions (Task 017 §7). Server-timestamped, event-sourced. Online-time is
// computed by intersecting persisted sessions with the report window — never a browser timer, and
// disconnected/idle time is simply the absence of an open session. Each session is its own event
// aggregate (id = session id, version 1 = online, 2 = offline) so analytics can measure duty time.

type Tx = Prisma.TransactionClient;

// Open a duty session if none is open. Idempotent (the nullable-unique activeDriverId guarantees
// at most one open session per driver).
export async function goOnline(tx: Tx, driverId: string): Promise<void> {
  const open = await tx.dutySession.findUnique({ where: { activeDriverId: driverId } });
  if (open) return;
  try {
    const s = await tx.dutySession.create({ data: { driverId, onlineAt: new Date(), activeDriverId: driverId } });
    await recordEvent(tx, {
      eventType: 'driver.online', aggregateType: 'duty', aggregateId: s.id, aggregateVersion: 1,
      correlationId: driverPseudo(driverId), occurredAt: s.onlineAt, payload: { driverPseudo: driverPseudo(driverId) },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // concurrent open
    throw e;
  }
}

// Close the open duty session, recording online seconds. Idempotent (no-op if already closed).
export async function goOffline(tx: Tx, driverId: string, source: 'driver' | 'system' = 'driver'): Promise<void> {
  const open = await tx.dutySession.findUnique({ where: { activeDriverId: driverId } });
  if (!open) return;
  const now = new Date();
  await tx.dutySession.update({ where: { id: open.id }, data: { offlineAt: now, activeDriverId: null, source } });
  await recordEvent(tx, {
    eventType: 'driver.offline', aggregateType: 'duty', aggregateId: open.id, aggregateVersion: 2,
    correlationId: driverPseudo(driverId), occurredAt: now,
    payload: { driverPseudo: driverPseudo(driverId), onlineSec: Math.round((now.getTime() - open.onlineAt.getTime()) / 1000) },
  });
}

// Sum of duty-session time intersected with [from, to). An open session counts up to `to` (or now).
export async function onlineSecondsInWindow(driverId: string, from: Date, to: Date, now: Date = new Date()): Promise<number> {
  const sessions = await prisma.dutySession.findMany({
    where: { driverId, onlineAt: { lt: to }, OR: [{ offlineAt: null }, { offlineAt: { gt: from } }] },
    select: { onlineAt: true, offlineAt: true },
  });
  let sec = 0;
  for (const s of sessions) {
    const a = Math.max(s.onlineAt.getTime(), from.getTime());
    const b = Math.min(s.offlineAt?.getTime() ?? now.getTime(), to.getTime());
    if (b > a) sec += (b - a) / 1000;
  }
  return Math.round(sec);
}

export async function hasOpenSession(driverId: string): Promise<boolean> {
  return !!(await prisma.dutySession.findUnique({ where: { activeDriverId: driverId }, select: { id: true } }));
}

// «Время на линии» window (2026-11-20): today's online time, how much of it on orders, the km driven
// on orders today (to the client + A → B), and Monday–Sunday per day (online time + km) for the chart.
export interface DutyDay { day: string; onlineSec: number; km: number }
export interface DutyToday {
  onlineSec: number; onTripSec: number; km: number; weekSec: number; weekKm: number;
  week: DutyDay[]; // Monday … Sunday (Cyprus calendar), future days zero
  onlineNow: boolean;
}

const MAX_ACC_M = 50, MAX_KMH = 250;
// Km driven inside [from, to): the GPS track, glitches out (poor accuracy, jumps > 250 km/h).
async function gpsKm(driverId: string, from: Date, to: Date): Promise<{ km: number; points: number }> {
  if (to <= from) return { km: 0, points: 0 };
  const pts = await prisma.gpsSample.findMany({ where: { driverId, sampledAt: { gte: from, lt: to } }, select: { lat: true, lng: true, accuracyM: true, sampledAt: true }, orderBy: { sampledAt: 'asc' }, take: 20_000 });
  let m = 0, prev: (typeof pts)[number] | null = null, n = 0;
  for (const p of pts) {
    if (p.accuracyM > MAX_ACC_M) continue;
    n += 1;
    if (prev) {
      const dt = (p.sampledAt.getTime() - prev.sampledAt.getTime()) / 1000;
      const d = haversineMeters(prev, p);
      if (dt > 0 && (d / dt) * 3.6 > MAX_KMH) continue;
      m += d;
    }
    prev = p;
  }
  return { km: m / 1000, points: n };
}

export async function dutyToday(driverId: string, dayStart: Date, weekStart: Date, now: Date = new Date()): Promise<DutyToday> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const sessions = await prisma.dutySession.findMany({
    where: { driverId, onlineAt: { lt: weekEnd }, OR: [{ offlineAt: null }, { offlineAt: { gt: weekStart } }] },
    select: { onlineAt: true, offlineAt: true },
  });
  const asgs = await prisma.assignment.findMany({
    where: { driverId, assignedAt: { lt: weekEnd }, OR: [{ endedAt: null }, { endedAt: { gt: weekStart } }] },
    select: { assignedAt: true, endedAt: true, reason: true, booking: { select: { quoteId: true } } },
  });
  // Km per assignment (from the driver taking it to its end = to the client + A → B), by GPS; with no
  // track for a completed ride, the booked A → B distance (never more invented than that).
  const quoteIds = asgs.map((a) => a.booking.quoteId).filter((x): x is string => !!x);
  const quotes = new Map((quoteIds.length ? await prisma.quote.findMany({ where: { id: { in: quoteIds } }, select: { id: true, distanceMeters: true } }) : []).map((q) => [q.id, q.distanceMeters]));
  const dayMs = 86_400_000;
  const week: DutyDay[] = Array.from({ length: 7 }, (_, i) => ({ day: nicosiaDayKey(new Date(weekStart.getTime() + i * dayMs + 12 * 3600_000)), onlineSec: 0, km: 0 }));
  const idx = (t: number) => Math.floor((t - weekStart.getTime()) / dayMs);
  // Online time spread over the days it touched (DST-safe enough: Cyprus midnights from weekStart + n days).
  const dayStartOf = (i: number) => weekStart.getTime() + i * dayMs;
  for (const s of sessions) {
    const a = Math.max(s.onlineAt.getTime(), weekStart.getTime()), b = Math.min(s.offlineAt?.getTime() ?? now.getTime(), now.getTime(), weekEnd.getTime());
    for (let i = Math.max(0, idx(a)); i <= Math.min(6, idx(b - 1)); i++) {
      const x = Math.max(a, dayStartOf(i)), y = Math.min(b, dayStartOf(i + 1));
      if (y > x) week[i].onlineSec += (y - x) / 1000;
    }
  }
  let onTripMs = 0;
  for (const a of asgs) {
    const from = Math.max(a.assignedAt.getTime(), weekStart.getTime()), to = Math.min(a.endedAt?.getTime() ?? now.getTime(), now.getTime(), weekEnd.getTime());
    if (to <= from) continue;
    onTripMs += Math.max(0, Math.min(to, now.getTime()) - Math.max(from, dayStart.getTime()));
    const g = await gpsKm(driverId, new Date(from), new Date(to));
    const km = g.points >= 2 ? g.km : a.reason === 'completed' && a.booking.quoteId && quotes.has(a.booking.quoteId) ? quotes.get(a.booking.quoteId)! / 1000 : 0;
    const i = Math.min(6, Math.max(0, idx(to - 1)));
    week[i].km += km;
  }
  for (const d of week) { d.onlineSec = Math.round(d.onlineSec); d.km = Math.round(d.km * 10) / 10; }
  const today = week[Math.min(6, Math.max(0, idx(now.getTime())))];
  const onlineSec = today.onlineSec;
  return {
    onlineSec, onTripSec: Math.min(onlineSec, Math.round(onTripMs / 1000)), km: today.km,
    weekSec: week.reduce((n, d) => n + d.onlineSec, 0), weekKm: Math.round(week.reduce((n, d) => n + d.km, 0) * 10) / 10,
    week, onlineNow: sessions.some((s) => !s.offlineAt),
  };
}
