import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { rateLimit } from '@/lib/rate-limit';
import { claimFreeOrder } from '@/server/dispatch/free-orders';

export const dynamic = 'force-dynamic';

// Driver takes a free order (see src/server/dispatch/free-orders.ts).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('free-claim', ctx.driver.id, 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const { id } = await params;
  const result = await claimFreeOrder(id, ctx.driver.id);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
