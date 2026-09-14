import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { startReview } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await startReview(id, ctx.user.id);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
