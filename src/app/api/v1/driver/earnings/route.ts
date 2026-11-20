import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reportEarnings } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await reportEarnings(ctx.driver.id, new URL(req.url)));
}
