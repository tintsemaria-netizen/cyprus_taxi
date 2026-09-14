import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// ADMIN-only: (re)create the ClickHouse schema and seed reconstructed snapshots for pre-event
// bookings. Idempotent. Separate from web startup; safe to run repeatedly. Backfill is bounded
// per call and returns a cursor so the admin can page through large histories.
export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  if (!config.analytics.enabled) return apiError(409, 'ANALYTICS_DISABLED', 'ClickHouse is not configured.');

  let body: { backfill?: boolean; afterCreatedAt?: string; batch?: number } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const { ensureClickHouseSchema } = await import('@/server/analytics/clickhouse-export');
  await ensureClickHouseSchema();

  let backfill = null;
  if (body.backfill) {
    const { backfillBookingSnapshots } = await import('@/server/analytics/backfill');
    const after = body.afterCreatedAt ? new Date(body.afterCreatedAt) : undefined;
    backfill = await backfillBookingSnapshots(Math.min(Math.max(body.batch ?? 200, 1), 1000), after && !Number.isNaN(after.getTime()) ? after : undefined);
  }
  return apiOk({ ok: true, schemaEnsured: true, backfill });
}
