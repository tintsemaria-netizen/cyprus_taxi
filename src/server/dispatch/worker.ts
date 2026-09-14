import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { findBestCandidate, RADIUS_STAGES_KM } from './eligibility';
import { createOffer, expireOffer } from './offers';
import { rematchBooking } from './lifecycle';
import { enqueuePassenger } from '@/server/push';
import { recordEvent } from '@/server/events';
import { heartbeat } from '@/server/workers/heartbeat';

// Supervised worker loop (Task 012 §4, restructured for Task 016 §4). Postgres-backed jobs with
// a lease so multiple instances/ticks are safe; recovers on restart because state lives in the DB.
// One tick runs FOUR isolated sections in priority order — dispatch first (never blocked by the
// others), then notifications, analytics export, and (on a slow cadence) maintenance. Each writes
// a WorkerHeartbeat so cross-process health is real, not a module-local timer. External calls
// (Google, push, ClickHouse) happen outside DB transactions.

const TICK_MS = 2000;
const LEASE_MS = 10_000;
const MAINTENANCE_EVERY_TICKS = Math.max(1, Math.round(300_000 / TICK_MS)); // ~5 min

// Next.js compiles instrumentation.ts and route handlers into SEPARATE bundles, so a
// plain module-level singleton would be duplicated. Anchor the worker state on globalThis
// so the health route and the worker (started from instrumentation) share one instance,
// and the timer is never started twice.
interface DispatchState { running: boolean; timer: ReturnType<typeof setInterval> | null; lastTickAt: number; workerId: string; tickCount: number; }
const g = globalThis as unknown as { __ilyasDispatch?: DispatchState };
const state: DispatchState = (g.__ilyasDispatch ??= { running: false, timer: null, lastTickAt: 0, workerId: `w-${Math.floor(Date.now() % 1e9)}-${process.pid}`, tickCount: 0 });

// In-process view (used only in the legacy single-process mode). In dedicated-worker mode the
// health route reads WorkerHeartbeat instead, because the worker ticks in a different process.
export function getDispatchHealth() {
  return { workerId: state.workerId, lastTickAt: state.lastTickAt, alive: state.lastTickAt > 0 && Date.now() - state.lastTickAt < TICK_MS * 5 };
}

export function startWorkers() {
  if (state.timer) return; // already started
  state.timer = setInterval(() => { void runOnce(); }, TICK_MS);
  // eslint-disable-next-line no-console
  console.log(`[worker] ${state.workerId} started (tick ${TICK_MS}ms)`);
}
// Back-compat alias (older callers / tests).
export const startDispatchWorker = startWorkers;

export async function runOnce(): Promise<void> {
  if (state.running) return; // never overlap ticks in this process
  state.running = true;
  try {
    state.lastTickAt = Date.now();
    state.tickCount++;
    const now = new Date();

    // --- Section 1: DISPATCH (highest priority; isolated so a slow section never delays it) ---
    try {
      await runDispatchSection(now);
      await heartbeat('dispatch', state.workerId, { tick: state.tickCount });
    } catch (e) { console.error('[dispatch] section error', e); }

    // --- Section 2: NOTIFICATIONS (durable outbox drain) ---
    try {
      const { drainOutbox } = await import('@/server/outbox');
      const r = await drainOutbox(now);
      await heartbeat('notifications', state.workerId, { claimed: r.claimed });
    } catch (e) { console.error('[outbox] drain error', e); }

    // --- Section 3: ANALYTICS EXPORT (no-op unless ClickHouse configured; never blocks ops) ---
    try {
      const { drainAnalytics } = await import('@/server/analytics/exporter');
      const r = await drainAnalytics(now);
      await heartbeat('analytics', state.workerId, r);
    } catch (e) { console.error('[analytics] export error', e); }

    // --- Section 4: MAINTENANCE (slow cadence: retention, doc-expiry enforcement) ---
    if (state.tickCount % MAINTENANCE_EVERY_TICKS === 0) {
      try {
        const { runMaintenance } = await import('@/server/workers/maintenance');
        const r = await runMaintenance(now);
        try { const { enforceDocumentExpiries } = await import('@/server/applications'); await enforceDocumentExpiries(now); } catch (e) { console.error('[expiry] error', e); }
        await heartbeat('maintenance', state.workerId, r);
      } catch (e) { console.error('[maintenance] error', e); }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[worker] tick error', e);
  } finally {
    state.running = false;
  }
}

// The dispatch work of a single tick: promote scheduled, rematch on GPS loss, resolve expired
// offers, and advance SEARCHING bookings that have no live offer.
async function runDispatchSection(now: Date): Promise<void> {
  await promoteScheduled(now);
  await rematchOnGpsLoss(now);

  const expired = await prisma.driverOffer.findMany({ where: { status: 'OFFERED', expiresAt: { lt: now } }, select: { id: true } });
  for (const o of expired) await expireOffer(o.id);

  const jobs = await prisma.dispatchJob.findMany({
    where: { booking: { status: 'SEARCHING' }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    select: { id: true, bookingId: true },
    take: 25,
  });
  for (const j of jobs) {
    const active = await prisma.driverOffer.findFirst({ where: { activeBookingId: j.bookingId } });
    if (active) continue; // waiting on an outstanding offer
    // Claim a short lease so only one worker/tick processes this job.
    const claimed = await prisma.dispatchJob.updateMany({
      where: { id: j.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseOwner: state.workerId, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    try {
      await processJob(j.id);
    } catch (e) {
      // Isolate per-job failure (e.g. a slow/erroring route lookup) so it never stops
      // deadline handling for the rest of the queue this tick.
      // eslint-disable-next-line no-console
      console.error(`[dispatch] job ${j.id} error`, e);
    } finally {
      await prisma.dispatchJob.updateMany({ where: { id: j.id, leaseOwner: state.workerId }, data: { leaseUntil: null, leaseOwner: null } });
    }
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = await prisma.dispatchJob.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job || job.booking.status !== 'SEARCHING') return;

  // Deadline reached without acceptance → give up (NO_DRIVER).
  if (job.deadlineAt < new Date()) {
    const gaveUp = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${job.bookingId} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: job.bookingId } });
      let flagged = false;
      if (b && b.status === 'SEARCHING') {
        const ub = await tx.booking.update({ where: { id: job.bookingId }, data: { status: 'NO_DRIVER', revision: { increment: 1 } } });
        await tx.bookingEvent.create({ data: { bookingId: job.bookingId, type: 'NO_DRIVER', actorType: 'SYSTEM', beforeStatus: 'SEARCHING', afterStatus: 'NO_DRIVER' } });
        await recordEvent(tx, { eventType: 'booking.no_driver', aggregateType: 'booking', aggregateId: job.bookingId, aggregateVersion: ub.revision, correlationId: job.bookingId, payload: { bookingId: job.bookingId, status: 'NO_DRIVER' } });
        await enqueuePassenger(tx, job.bookingId, 'No driver available', 'We couldn’t find a driver right now. Tap to try again.');
        flagged = true;
      }
      await tx.dispatchJob.deleteMany({ where: { id: jobId } });
      return flagged;
    });
    void gaveUp;
    return;
  }

  // Find the best candidate, expanding the radius in stages if the closer ring is empty.
  let stage = job.radiusStage;
  let candidate = await findBestCandidate(job.booking, RADIUS_STAGES_KM[Math.min(stage, RADIUS_STAGES_KM.length - 1)], job.triedDriverIds);
  while (!candidate && stage < RADIUS_STAGES_KM.length - 1) {
    stage++;
    candidate = await findBestCandidate(job.booking, RADIUS_STAGES_KM[stage], job.triedDriverIds);
  }
  if (stage !== job.radiusStage) await prisma.dispatchJob.update({ where: { id: jobId }, data: { radiusStage: stage } });
  if (!candidate) return; // no eligible driver right now — retry next tick until the deadline
  await createOffer(job.bookingId, candidate);
}

// Scheduled rides sit as REQUESTED until their lead window, then enter live dispatch.
// The search deadline runs to pickup time (never reserving a driver for hours ahead).
async function promoteScheduled(now: Date): Promise<void> {
  const leadMs = config.dispatch.scheduleLeadMinutes * 60 * 1000;
  const due = await prisma.booking.findMany({
    where: { status: 'REQUESTED', scheduledAt: { not: null, lte: new Date(now.getTime() + leadMs) } },
    select: { id: true },
    take: 25,
  });
  for (const s of due) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${s.id} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: s.id } });
      if (!b || b.status !== 'REQUESTED' || !b.scheduledAt) return;
      const deadline = new Date(Math.max(now.getTime() + config.dispatch.searchDeadlineSeconds * 1000, b.scheduledAt.getTime()));
      await tx.dispatchJob.deleteMany({ where: { bookingId: b.id } });
      await tx.dispatchJob.create({ data: { bookingId: b.id, deadlineAt: deadline } });
      const ub = await tx.booking.update({ where: { id: b.id }, data: { status: 'SEARCHING', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: b.id, type: 'SCHEDULED_PROMOTED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'SEARCHING' } });
      await recordEvent(tx, { eventType: 'booking.scheduled_promoted', aggregateType: 'booking', aggregateId: b.id, aggregateVersion: ub.revision, correlationId: b.id, payload: { bookingId: b.id, status: 'SEARCHING' } });
    });
  }
}

// Prolonged pre-pickup GPS loss expires the assignment and rematches. Only ASSIGNED /
// EN_ROUTE (never ARRIVED or IN_PROGRESS — an in-trip GPS drop must not reassign anyone).
async function rematchOnGpsLoss(now: Date): Promise<void> {
  const cutoff = now.getTime() - config.dispatch.gpsLossRematchSeconds * 1000;
  const active = await prisma.assignment.findMany({
    where: { activeBookingId: { not: null }, booking: { status: { in: ['ASSIGNED', 'EN_ROUTE'] } } },
    select: { id: true, activeBookingId: true, driverId: true, assignedAt: true },
  });
  for (const a of active) {
    const loc = await prisma.latestDriverLocation.findUnique({ where: { driverId: a.driverId } });
    const lastAt = loc ? Math.max(loc.sampledAt.getTime(), loc.receivedAt.getTime()) : a.assignedAt.getTime();
    if (lastAt >= cutoff) continue; // still fresh enough (cheap pre-check)
    const rematched = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${a.activeBookingId!} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: a.activeBookingId! } });
      if (!b || !['ASSIGNED', 'EN_ROUTE'].includes(b.status)) return false; // never ARRIVED/IN_PROGRESS
      // Guard against a stale observation: the active assignment must still be the exact
      // one we sampled (not a fresh replacement), and its driver's GPS still lost.
      const cur = await tx.assignment.findFirst({ where: { activeBookingId: b.id } });
      if (!cur || cur.id !== a.id || cur.driverId !== a.driverId) return false;
      const loc2 = await tx.latestDriverLocation.findUnique({ where: { driverId: cur.driverId } });
      const lastAt2 = loc2 ? Math.max(loc2.sampledAt.getTime(), loc2.receivedAt.getTime()) : cur.assignedAt.getTime();
      if (lastAt2 >= now.getTime() - config.dispatch.gpsLossRematchSeconds * 1000) return false; // GPS recovered under lock
      await rematchBooking(tx, b.id, cur.driverId, 'prolonged pre-pickup GPS loss', 'SYSTEM');
      return true;
    });
    void rematched; // passenger rematch notification is enqueued inside rematchBooking (atomic)
  }
}
