import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { changeStatus } from '@/server/assignments';

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

  // changeStatus records the cancellation event and enqueues the driver notification
  // atomically (Task 016 §4), so there is no fire-and-forget gap after the commit.
  const result = await changeStatus({
    bookingId,
    to: 'CANCELED',
    expectedRevision: body.expectedRevision,
    actor: 'PASSENGER',
    reason: 'passenger canceled',
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
