import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverReleaseNext } from '@/server/dispatch/lifecycle';

export const dynamic = 'force-dynamic';

// The driver gives back his next ride (taken while finishing a trip, 2026-11-25).
export async function POST() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const r = await driverReleaseNext(ctx.driver.id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true });
}
