import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { recordEvent, driverPseudo } from '@/server/events';

export type IngestResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

// Validate + persist a driver's own GPS sample (SPEC §6). Identity is bound to
// the authenticated driver; driverId is never trusted from the request body.
// On-duty drivers may share foreground GPS even before an assignment so the
// dispatcher fleet view shows available positions; off-duty GPS is rejected.
export async function ingestLocation(
  driverId: string,
  sample: {
    lat: number;
    lng: number;
    accuracyM: number;
    heading?: number;
    speed?: number;
    sampledAt: string;
    gpsSession: string;
    sequence: number;
  },
): Promise<IngestResult> {
  const now = Date.now();
  const sampledAt = new Date(sample.sampledAt);
  if (Number.isNaN(sampledAt.getTime())) return reject(422, 'BAD_SAMPLE', 'Invalid sampledAt.');
  if (sampledAt.getTime() > now + 60_000) return reject(422, 'FUTURE_SAMPLE', 'Sample timestamp is in the future.');
  if (sampledAt.getTime() < now - 120_000) return reject(422, 'STALE_SAMPLE', 'Sample is too old.');

  // Re-check activation and duty at ingestion time (deactivation/off-duty stops GPS).
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
  if (!driver || !driver.active || !driver.user.active) return reject(403, 'INACTIVE', 'Driver is not active.');
  if (!driver.onDuty) return reject(409, 'OFF_DUTY', 'Driver is off duty; location not accepted.');

  const data = {
    lat: sample.lat, lng: sample.lng, accuracyM: sample.accuracyM,
    heading: sample.heading ?? null, speed: sample.speed ?? null,
    sampledAt, receivedAt: new Date(), gpsSession: sample.gpsSession, sequence: sample.sequence,
  };

  // Up to two attempts: if no row exists we insert; if a concurrent insert wins the
  // race we retry as a conditional update (so the newer sample is not silently lost).
  // Each accepted write ALSO persists durable GPS history + a domain event in the SAME
  // transaction (Task 016 §5), so live state and history can never diverge; rejected /
  // out-of-order samples never reach the history table.
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await prisma.$transaction(async (tx): Promise<'ok' | 'race' | 'out_of_order'> => {
      const existing = await tx.latestDriverLocation.findUnique({ where: { driverId } });
      if (!existing) {
        try {
          await tx.latestDriverLocation.create({ data: { driverId, ...data } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'race';
          throw e;
        }
      } else {
        // Fast-path rejects with clear codes (the conditional write below is authoritative).
        if (sampledAt.getTime() <= existing.sampledAt.getTime()) return 'out_of_order';
        if (existing.gpsSession === sample.gpsSession && sample.sequence <= existing.sequence) return 'out_of_order';
        // Atomic guarded write: replace only if the stored row is BOTH older by time AND
        // (a new session OR a strictly higher in-session sequence).
        const res = await tx.latestDriverLocation.updateMany({
          where: {
            driverId,
            sampledAt: { lt: sampledAt },
            OR: [{ gpsSession: { not: sample.gpsSession } }, { sequence: { lt: sample.sequence } }],
          },
          data,
        });
        if (res.count !== 1) return 'out_of_order'; // a concurrent newer sample won, or in-session reversal
      }
      // Accepted → durable history (idempotent on the sample identity) + domain event.
      const asg = await tx.assignment.findFirst({ where: { activeDriverId: driverId }, select: { activeBookingId: true } });
      const bookingId = asg?.activeBookingId ?? null;
      await tx.$executeRaw`
        INSERT INTO "GpsSample" (id, "driverId", "gpsSession", sequence, lat, lng, "accuracyM", heading, speed, "sampledAt", "receivedAt", "bookingId", "createdAt")
        VALUES (${randomUUID()}, ${driverId}, ${sample.gpsSession}, ${sample.sequence}, ${sample.lat}, ${sample.lng}, ${sample.accuracyM}, ${sample.heading ?? null}, ${sample.speed ?? null}, ${sampledAt}, now(), ${bookingId}, now())
        ON CONFLICT ("driverId", "gpsSession", sequence) DO NOTHING`;
      await recordEvent(tx, {
        eventType: 'gps.sample', aggregateType: 'gps', aggregateId: `${driverId}:${sample.gpsSession}`, aggregateVersion: sample.sequence,
        occurredAt: sampledAt, correlationId: bookingId,
        payload: { driverPseudo: driverPseudo(driverId), gpsSession: sample.gpsSession, sequence: sample.sequence, lat: sample.lat, lng: sample.lng, accuracyM: sample.accuracyM, heading: sample.heading ?? null, speed: sample.speed ?? null, bookingId },
      });
      return 'ok';
    });
    if (outcome === 'ok') return { ok: true };
    if (outcome === 'out_of_order') return reject(409, 'OUT_OF_ORDER', 'Older or duplicate sample ignored.');
    // race → retry once as a conditional update (existing row now present)
  }
  return reject(409, 'OUT_OF_ORDER', 'Could not store sample after a concurrent update.');
}

function reject(status: number, code: string, message: string): IngestResult {
  return { ok: false, status, code, message };
}
