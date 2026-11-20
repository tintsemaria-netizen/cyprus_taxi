import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reportAnalytics } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// GET /api/v1/driver/analytics?period=day|week&day=YYYY-MM-DD (Cyprus calendar; default today).
// A week runs Monday–Sunday around the given day.
export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await reportAnalytics(ctx.driver.id, new URL(req.url)));
}
