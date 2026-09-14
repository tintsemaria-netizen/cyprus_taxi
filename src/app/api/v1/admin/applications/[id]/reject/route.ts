import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { rejectApplication } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { reason?: string; expectedRevision?: number }; try { body = await req.json(); } catch { return Errors.validation({ _: "Invalid JSON." }); }
  const r = await rejectApplication(id, ctx.user.id, body.reason || "", body.expectedRevision);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
