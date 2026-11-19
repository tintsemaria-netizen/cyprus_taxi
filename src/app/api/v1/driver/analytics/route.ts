import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverAnalytics, mondayOf } from '@/server/driver/analytics';
import { nicosiaDayKey } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

// GET /api/v1/driver/analytics?period=day|week&day=YYYY-MM-DD (Cyprus calendar; default today).
// A week runs Monday–Sunday around the given day.
export async function GET(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const url = new URL(req.url);
  const raw = url.searchParams.get('day');
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nicosiaDayKey(new Date());
  const week = url.searchParams.get('period') === 'week';
  return apiOk(await driverAnalytics(ctx.driver.id, week ? mondayOf(day) : day, week ? 7 : 1));
}
