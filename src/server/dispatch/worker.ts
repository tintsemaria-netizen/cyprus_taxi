import { prisma } from '@/lib/db';
import { findBestCandidate, RADIUS_STAGES_KM } from './eligibility';
import { createOffer, expireOffer } from './offers';

// Durable-ish in-process dispatch worker (Task 012 §4). Postgres-backed jobs with a lease
// so multiple instances/ticks are safe; recovers on restart because state lives in the DB
// (not in memory). External Google calls happen outside DB transactions.

const TICK_MS = 2000;
const LEASE_MS = 10_000;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
const workerId = `w-${Math.floor(Date.now() % 1e9)}-${process.pid}`;

export function getDispatchHealth() {
  return { workerId, lastTickAt, alive: lastTickAt > 0 && Date.now() - lastTickAt < TICK_MS * 5 };
}

export function startDispatchWorker() {
  if (timer) return; // already started
  timer = setInterval(() => { void runOnce(); }, TICK_MS);
  // eslint-disable-next-line no-console
  console.log(`[dispatch] worker ${workerId} started (tick ${TICK_MS}ms)`);
}

export async function runOnce(): Promise<void> {
  if (running) return; // never overlap ticks in this process
  running = true;
  try {
    lastTickAt = Date.now();
    const now = new Date();

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
        data: { leaseOwner: workerId, leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (claimed.count === 0) continue;
      try {
        await processJob(j.id);
      } finally {
        await prisma.dispatchJob.updateMany({ where: { id: j.id, leaseOwner: workerId }, data: { leaseUntil: null, leaseOwner: null } });
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[dispatch] tick error', e);
  } finally {
    running = false;
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = await prisma.dispatchJob.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job || job.booking.status !== 'SEARCHING') return;

  // Deadline reached without acceptance → give up (NO_DRIVER).
  if (job.deadlineAt < new Date()) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${job.bookingId} FOR UPDATE`;
      const b = await tx.booking.findUnique({ where: { id: job.bookingId } });
      if (b && b.status === 'SEARCHING') {
        await tx.booking.update({ where: { id: job.bookingId }, data: { status: 'NO_DRIVER', revision: { increment: 1 } } });
        await tx.bookingEvent.create({ data: { bookingId: job.bookingId, type: 'NO_DRIVER', actorType: 'SYSTEM', beforeStatus: 'SEARCHING', afterStatus: 'NO_DRIVER' } });
      }
      await tx.dispatchJob.deleteMany({ where: { id: jobId } });
    });
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
