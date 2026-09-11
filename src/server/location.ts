import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

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
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await prisma.latestDriverLocation.findUnique({ where: { driverId } });

    if (!existing) {
      try {
        await prisma.latestDriverLocation.create({ data: { driverId, ...data } });
        return { ok: true };
      } catch (e) {
        // ONLY a uniqueness race is a retry; anything else is a real error (never
        // mislabelled OUT_OF_ORDER).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }

    // Fast-path rejects with clear codes (the conditional write below is authoritative).
    if (sampledAt.getTime() <= existing.sampledAt.getTime()) {
      return reject(409, 'OUT_OF_ORDER', 'Older or duplicate sample ignored.');
    }
    if (existing.gpsSession === sample.gpsSession && sample.sequence <= existing.sequence) {
      return reject(409, 'OUT_OF_ORDER', 'Older or duplicate sample ignored.');
    }

    // Atomic guarded write: replace only if the stored row is BOTH older by time AND
    // (a new session OR a strictly higher in-session sequence). This preserves both
    // monotonic requirements even under concurrent samples.
    const res = await prisma.latestDriverLocation.updateMany({
      where: {
        driverId,
        sampledAt: { lt: sampledAt },
        OR: [{ gpsSession: { not: sample.gpsSession } }, { sequence: { lt: sample.sequence } }],
      },
      data,
    });
    if (res.count === 1) return { ok: true };
    // count 0 → a concurrent newer sample won, or an in-session sequence reversal.
    return reject(409, 'OUT_OF_ORDER', 'A newer position was recorded concurrently.');
  }
  return reject(409, 'OUT_OF_ORDER', 'Could not store sample after a concurrent update.');
}

function reject(status: number, code: string, message: string): IngestResult {
  return { ok: false, status, code, message };
}
