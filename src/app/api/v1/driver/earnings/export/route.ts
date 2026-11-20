import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { Errors } from '@/lib/http';
import { reportStatementCsv } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// CSV statement of the driver's own trips in a window (shared with the admin's per-driver export).
export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return reportStatementCsv(ctx.driver.id, new URL(req.url));
}
