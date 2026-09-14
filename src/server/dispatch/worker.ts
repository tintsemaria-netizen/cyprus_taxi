import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { findBestCandidate, RADIUS_STAGES_KM } from './eligibility';
import { createOffer, expireOffer } from './offers';
import { rematchBooking } from './lifecycle';
import { notifyPassenger } from '@/server/push';

// Durable-ish in-process dispatch worker (Task 012 §4). Postgres-backed jobs with a lease
// so multiple instances/ticks are safe; recovers on restart because state lives in the DB
// (not in memory). External Google calls happen outside DB transactions.

const TICK_MS = 2000;
const LEASE_MS = 10_000;

// Next.js compiles instrumentation.ts and route handlers into SEPARATE bundles, so a
// plain module-level singleton would be duplicated. Anchor the worker state on globalThis
// so the health route and the worker (started from instrumentation) share one instance,
// and the timer is never started twice.
interface DispatchState { running: boolean; timer: ReturnType<typeof setInterval> | null; lastTickAt: number; workerId: string; }
const g = globalThis as unknown as { __ilyasDispatch?: DispatchState };
const state: DispatchState = (g.__ilyasDispatch ??= { running: false, timer: null, lastTickAt: 0, workerId: `w-${Math.floor(Date.now() % 1e9)}-${process.pid}` });

export function getDispatchHealth() {
  return { workerId: state.workerId, lastTickAt: state.lastTickAt, alive: state.lastTickAt > 0 && Date.now() - state.lastTickAt < TICK_MS * 5 };
}

export function startDispatchWorker() {
  if (state.timer) return; // already started
  state.timer = setInterval(() => { void runOnce(); }, TICK_MS);
  // eslint-disable-next-line no-console
  console.log(`[dispatch] worker ${state.workerId} started (tick ${TICK_MS}ms)`);
}

export async function runOnce(): Promise<void> {
  if (state.running) return; // never overlap ticks in this process
  state.running = true;
  try {
    state.lastTickAt = Date.now();
    const now = new Date();

    // 0) Promote scheduled rides whose dispatch lead window has arrived, and rematch
    //    pre-pickup trips whose driver's GPS has been lost too long.
    await promoteScheduled(now);
    await rematchOnGpsLoss(now);
    // Durable notification delivery + document-expiry enforcement (best-effort, isolated).
    try { const { drainOutbox } = await import('@/server/outbox'); await drainOutbox(now); } catch (e) { console.error('[outbox] drain error', e); }
    if (now.getMinutes() % 5 === 0) { try { const { enforceDocumentExpiries } = await import('@/server/applications'); await enforceDocumentExpiries(now); } catch (e) { console.error('[expiry] error', e); } }

    // 1) Resolve timed-out offers (release reservation, remember the driver).
    const expired = await prisma.driverOffer.findMany({ where: { status: 'OFFERED', expiresAt: { lt: now } }, select: { id: true } });
    for (const o of expired) await expireOffer(o.id);

    // 2) Advance SEARCHING bookings that currently have no live offer.
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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[dispatch] tick error', e);
  } finally {
    state.running = false;
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
        await tx.booking.update({ where: { id: job.bookingId }, data: { status: 'NO_DRIVER', revision: { increment: 1 } } });
        await tx.bookingEvent.create({ data: { bookingId: job.bookingId, type: 'NO_DRIVER', actorType: 'SYSTEM', beforeStatus: 'SEARCHING', afterStatus: 'NO_DRIVER' } });
        flagged = true;
      }
      await tx.dispatchJob.deleteMany({ where: { id: jobId } });
      return flagged;
    });
    if (gaveUp) void notifyPassenger(job.bookingId, 'No driver available', 'We couldn’t find a driver right now. Tap to try again.').catch(() => {});
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
      await tx.booking.update({ where: { id: b.id }, data: { status: 'SEARCHING', revision: { increment: 1 } } });
      await tx.bookingEvent.create({ data: { bookingId: b.id, type: 'SCHEDULED_PROMOTED', actorType: 'SYSTEM', beforeStatus: 'REQUESTED', afterStatus: 'SEARCHING' } });
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
    if (rematched) void notifyPassenger(a.activeBookingId!, 'Finding you another driver', 'Your driver lost connection — we’re matching you again.').catch(() => {});
  }
}
