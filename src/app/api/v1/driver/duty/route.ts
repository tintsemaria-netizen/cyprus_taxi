import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reportDuty } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The driver's online time today and this week (2026-11-20): for the «Время на линии» window.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await reportDuty(ctx.driver.id));
}
