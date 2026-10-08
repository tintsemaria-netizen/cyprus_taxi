import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { driverReliability, reliabilityWindow, FLAG_RULES } from '@/server/admin/reliability';

export const dynamic = 'force-dynamic';

// Per-driver reliability counts for a window (?days=7|30|90). ADMIN only.
export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const w = reliabilityWindow(new URL(req.url).searchParams.get('days'));
  return apiOk({ days: w.days, from: w.from.toISOString(), to: w.to.toISOString(), rules: FLAG_RULES, drivers: await driverReliability(w.from, w.to) });
}
