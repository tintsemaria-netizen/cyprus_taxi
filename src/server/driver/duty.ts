import { Prisma } from '@prisma/client';
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

// «Время на линии» window (2026-11-20): today's online time, how much of it on orders, today's
// sessions (on → off; an open one runs to now) and the week so far (Cyprus calendar, from Monday).
export interface DutyToday {
  onlineSec: number; onTripSec: number; freeSec: number; weekSec: number;
  sessions: { from: string; to: string | null; sec: number }[];
  onlineNow: boolean;
}
export async function dutyToday(driverId: string, dayStart: Date, weekStart: Date, now: Date = new Date()): Promise<DutyToday> {
  const sessions = await prisma.dutySession.findMany({
    where: { driverId, onlineAt: { lt: now }, OR: [{ offlineAt: null }, { offlineAt: { gt: dayStart } }] },
    select: { onlineAt: true, offlineAt: true }, orderBy: { onlineAt: 'asc' },
  });
  const clip = (a: number, b: number) => Math.max(0, Math.min(b, now.getTime()) - Math.max(a, dayStart.getTime()));
  const list = sessions.map((s) => {
    const end = s.offlineAt?.getTime() ?? now.getTime();
    return { from: new Date(Math.max(s.onlineAt.getTime(), dayStart.getTime())).toISOString(), to: s.offlineAt ? s.offlineAt.toISOString() : null, sec: Math.round(clip(s.onlineAt.getTime(), end) / 1000) };
  }).filter((s) => s.sec > 0 || s.to === null);
  const onlineSec = list.reduce((n, s) => n + s.sec, 0);
  // On orders: from assignment to its end (or now), within today.
  const asgs = await prisma.assignment.findMany({
    where: { driverId, assignedAt: { lt: now }, OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }] },
    select: { assignedAt: true, endedAt: true },
  });
  const onTripSec = Math.min(onlineSec, Math.round(asgs.reduce((n, a) => n + clip(a.assignedAt.getTime(), a.endedAt?.getTime() ?? now.getTime()), 0) / 1000));
  return {
    onlineSec, onTripSec, freeSec: Math.max(0, onlineSec - onTripSec),
    weekSec: await onlineSecondsInWindow(driverId, weekStart, now, now),
    sessions: list, onlineNow: sessions.some((s) => !s.offlineAt),
  };
}
