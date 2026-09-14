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
      correlationId: driverId, occurredAt: s.onlineAt, payload: { driverPseudo: driverPseudo(driverId) },
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
    correlationId: driverId, occurredAt: now,
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
