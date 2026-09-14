import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { config } from '@/lib/config';
import { normalizeWindow, overview, daily, fareSummary, driverUtilization, unavailable } from '@/server/analytics/queries';
import { pipelineStatus } from '@/server/analytics/reconcile';

export const dynamic = 'force-dynamic';

// ADMIN-only analytics read (Task 016 §8). Backed by ClickHouse via the read-only user. When the
// analytics store is absent/unreachable it returns an explicit unavailable state — never fake
// zeros. UTC is the storage + reporting timezone.
export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  const url = new URL(req.url);
  const f = normalizeWindow(url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
  f.includeTest = url.searchParams.get('test') === '1';
  const win = { from: f.from.toISOString(), to: f.to.toISOString(), includeTest: f.includeTest, timezone: 'UTC' };

  const pipeline = await pipelineStatus();
  if (!config.analytics.enabled || !pipeline.clickhouseReachable) {
    return apiOk({ available: false, reason: !config.analytics.enabled ? 'Analytics store not configured.' : 'ClickHouse is currently unreachable.', pipeline, window: win });
  }
  try {
    const [ov, series, fares, utilization] = await Promise.all([overview(f), daily(f), fareSummary(f), driverUtilization(f)]);
    return apiOk({ available: true, window: win, overview: ov, daily: series, fares, utilization, unavailable, pipeline });
  } catch (e) {
    return apiOk({ available: false, reason: 'Analytics query failed — try a narrower range.', detail: String((e as Error)?.message ?? e).slice(0, 200), pipeline, window: win });
  }
}
