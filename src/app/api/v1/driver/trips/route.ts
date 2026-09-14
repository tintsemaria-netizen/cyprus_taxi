import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { listDriverTrips } from '@/server/driver/trips';
import { driverWindow } from '@/server/driver/window';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const url = new URL(req.url);
  const range = url.searchParams.get('range');
  const w = range ? driverWindow(range, url.searchParams.get('from'), url.searchParams.get('to')) : { from: undefined, to: undefined, range: 'all' };
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const res = await listDriverTrips(ctx.driver.id, { from: w.from, to: w.to, limit, cursor });
  return apiOk({ range: w.range, ...res });
}
