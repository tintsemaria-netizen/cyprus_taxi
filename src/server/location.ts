import { prisma } from '@/lib/db';

export type IngestResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

// Validate + persist a driver's own GPS sample (SPEC §6). Identity is bound to
// the authenticated driver; driverId is never trusted from the request body.
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
  if (Number.isNaN(sampledAt.getTime())) {
    return { ok: false, status: 422, code: 'BAD_SAMPLE', message: 'Invalid sampledAt.' };
  }
  // Reject timestamps too far in the future or too old (SPEC §6).
  if (sampledAt.getTime() > now + 60_000) {
    return { ok: false, status: 422, code: 'FUTURE_SAMPLE', message: 'Sample timestamp is in the future.' };
  }
  if (sampledAt.getTime() < now - 120_000) {
    return { ok: false, status: 422, code: 'STALE_SAMPLE', message: 'Sample is too old.' };
  }

  // A driver must have an active assignment to share location.
  const active = await prisma.assignment.findFirst({ where: { activeDriverId: driverId } });
  if (!active) {
    return { ok: false, status: 409, code: 'NO_ACTIVE_TRIP', message: 'No active trip; location not accepted.' };
  }

  const existing = await prisma.latestDriverLocation.findUnique({ where: { driverId } });
  if (existing && existing.gpsSession === sample.gpsSession) {
    // Same session: reject out-of-order / replayed samples.
    if (sample.sequence <= existing.sequence) {
      return { ok: false, status: 409, code: 'OUT_OF_ORDER', message: 'Older or duplicate sample ignored.' };
    }
    if (existing.sampledAt.getTime() > sampledAt.getTime()) {
      return { ok: false, status: 409, code: 'OUT_OF_ORDER', message: 'Newer position already recorded.' };
    }
  }

  await prisma.latestDriverLocation.upsert({
    where: { driverId },
    create: {
      driverId,
      lat: sample.lat,
      lng: sample.lng,
      accuracyM: sample.accuracyM,
      heading: sample.heading ?? null,
      speed: sample.speed ?? null,
      sampledAt,
      receivedAt: new Date(),
      gpsSession: sample.gpsSession,
      sequence: sample.sequence,
    },
    update: {
      lat: sample.lat,
      lng: sample.lng,
      accuracyM: sample.accuracyM,
      heading: sample.heading ?? null,
      speed: sample.speed ?? null,
      sampledAt,
      receivedAt: new Date(),
      gpsSession: sample.gpsSession,
      sequence: sample.sequence,
    },
  });
  return { ok: true };
}
