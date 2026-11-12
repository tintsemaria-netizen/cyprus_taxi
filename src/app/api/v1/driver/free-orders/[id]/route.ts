import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { rateLimit } from '@/lib/rate-limit';
import { getFreeOrderDetail } from '@/server/dispatch/free-orders';

export const dynamic = 'force-dynamic';

// Details of one free order for the driver to review before taking it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('free-detail', ctx.driver.id, 30, 60); // each view may road-route
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const { id } = await params;
  const order = await getFreeOrderDetail(id, ctx.driver.id);
  if (!order) return apiError(404, 'ORDER_GONE', 'This ride is no longer available.');
  return apiOk({ order });
}
