import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { driverReliabilityDetail, reliabilityWindow } from '@/server/admin/reliability';

export const dynamic = 'force-dynamic';

// Recent reliability events for one driver (late releases, lapses, pre-pickup cancels, GPS releases,
// low ratings with tags/comments). ADMIN only.
export async function GET(req: Request, { params }: { params: Promise<{ driverId: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { driverId } = await params;
  const w = reliabilityWindow(new URL(req.url).searchParams.get('days'));
  return apiOk({ events: await driverReliabilityDetail(driverId, w.from, w.to) });
}
