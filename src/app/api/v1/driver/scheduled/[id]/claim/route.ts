import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { rateLimit } from '@/lib/rate-limit';
import { claimScheduled } from '@/server/dispatch/preassign';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('preassign-claim', ctx.driver.id, 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const { id } = await params;
  const r = await claimScheduled(ctx.driver.id, id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status });
}
