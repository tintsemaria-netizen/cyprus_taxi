import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { rateLimit } from '@/lib/rate-limit';
import { scheduledRideDetail } from '@/server/dispatch/preassign';

export const dynamic = 'force-dynamic';

// Details of one pre-booking for the driver to review before taking (or after accepting) it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('sched-detail', ctx.driver.id, 30, 60); // each view may road-route
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const { id } = await params;
  const ride = await scheduledRideDetail(id, ctx.driver.id);
  if (!ride) return apiError(404, 'ORDER_GONE', 'This ride is no longer available.');
  return apiOk({ ride });
}
