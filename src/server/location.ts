import { prisma } from '@/lib/db';

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

  const existing = await prisma.latestDriverLocation.findUnique({ where: { driverId } });
  if (existing) {
    // Reject out-of-order / replayed samples ACROSS sessions (by time) and within a
    // session (by sequence). A new session must still not accept an older position.
    if (sampledAt.getTime() <= existing.sampledAt.getTime()) {
      return reject(409, 'OUT_OF_ORDER', 'Older or duplicate sample ignored.');
    }
    if (existing.gpsSession === sample.gpsSession && sample.sequence <= existing.sequence) {
      return reject(409, 'OUT_OF_ORDER', 'Older or duplicate sample ignored.');
    }
    // Guarded conditional write: only replace if the stored row is still older than
    // this sample, so a concurrent newer sample cannot be clobbered by an older one.
    const res = await prisma.latestDriverLocation.updateMany({
      where: { driverId, sampledAt: { lt: sampledAt } },
      data: {
        lat: sample.lat, lng: sample.lng, accuracyM: sample.accuracyM,
        heading: sample.heading ?? null, speed: sample.speed ?? null,
        sampledAt, receivedAt: new Date(), gpsSession: sample.gpsSession, sequence: sample.sequence,
      },
    });
    if (res.count === 0) return reject(409, 'OUT_OF_ORDER', 'A newer position was recorded concurrently.');
    return { ok: true };
  }

  try {
    await prisma.latestDriverLocation.create({
      data: {
        driverId, lat: sample.lat, lng: sample.lng, accuracyM: sample.accuracyM,
        heading: sample.heading ?? null, speed: sample.speed ?? null,
        sampledAt, receivedAt: new Date(), gpsSession: sample.gpsSession, sequence: sample.sequence,
      },
    });
    return { ok: true };
  } catch {
    // A concurrent request created the row first; treat as a race and drop this sample.
    return reject(409, 'OUT_OF_ORDER', 'A newer position was recorded concurrently.');
  }
}

function reject(status: number, code: string, message: string): IngestResult {
  return { ok: false, status, code, message };
}
