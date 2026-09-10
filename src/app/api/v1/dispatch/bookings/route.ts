import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { dispatchQueue } from '@/server/views';
import { BookingStatus, VehicleClass } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN', 'DISPATCHER']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as BookingStatus | null;
  const vClass = url.searchParams.get('class') as VehicleClass | null;
  const q = url.searchParams.get('q') || undefined;
  const page = Number(url.searchParams.get('page') || '1');
  const pageSize = Number(url.searchParams.get('pageSize') || '25');

  const data = await dispatchQueue({
    status: status || undefined,
    vClass: vClass || undefined,
    q: q?.slice(0, 60),
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });
  return apiOk(data);
}
