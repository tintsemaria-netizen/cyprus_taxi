import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { earningsSummary, earningsDaily } from '@/server/driver/earnings';
import { driverWindow } from '@/server/driver/window';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const url = new URL(req.url);
  const w = driverWindow(url.searchParams.get('range'), url.searchParams.get('from'), url.searchParams.get('to'));
  const [summary, daily] = await Promise.all([
    earningsSummary(ctx.driver.id, w.from, w.to),
    earningsDaily(ctx.driver.id, w.from, w.to),
  ]);
  return apiOk({ range: w.range, summary, daily });
}
