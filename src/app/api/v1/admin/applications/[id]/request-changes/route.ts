import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { requestChanges } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { reason?: string }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  const r = await requestChanges(id, ctx.user.id, body.reason || '');
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
