import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reliabilityView } from '@/server/reports/reliability-view';

export const dynamic = 'force-dynamic';

// «Моя надёжность» (2026-11-27, operator): the driver's own 30-day figures — the same tool as the admin's.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const v = await reliabilityView(ctx.driver.id);
  return v ? apiOk(v) : Errors.notFound();
}
