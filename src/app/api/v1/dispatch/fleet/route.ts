import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { fleet } from '@/server/views';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaff(['ADMIN', 'DISPATCHER']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ vehicles: await fleet() });
}
