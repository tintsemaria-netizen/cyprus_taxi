import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reportMonthly } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The driver's own monthly statement (2026-11-28) — same function as the admin's and the fleet owner's
// (/admin|fleet/drivers/:id/report/monthly).
export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await reportMonthly(ctx.driver.id, new URL(req.url)));
}
