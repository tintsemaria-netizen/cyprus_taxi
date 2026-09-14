import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { changeStatus } from '@/server/assignments';
import { prisma } from '@/lib/db';
import { notifyDriverByDriverId } from '@/server/push';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();

  let body: { expectedRevision?: number };
  try {
    body = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  if (typeof body.expectedRevision !== 'number') {
    return Errors.validation({ expectedRevision: 'Required.' });
  }

  // Capture the assigned driver BEFORE cancellation frees the assignment, so we can
  // notify them if the cancel succeeds.
  const active = await prisma.assignment.findFirst({ where: { activeBookingId: bookingId }, select: { driverId: true } });

  const result = await changeStatus({
    bookingId,
    to: 'CANCELED',
    expectedRevision: body.expectedRevision,
    actor: 'PASSENGER',
    reason: 'passenger canceled',
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  if (active) void notifyDriverByDriverId(active.driverId, 'Ride canceled', 'The passenger canceled this ride.').catch(() => {});
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
