import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { listPassengers } from '@/server/admin-passengers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return apiOk(await listPassengers(q.slice(0, 100)));
}
