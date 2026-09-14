import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { approveApplication } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { expectedRevision?: number }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (typeof body.expectedRevision !== 'number') return Errors.validation({ expectedRevision: 'Required (concurrency guard).' });
  const r = await approveApplication(id, ctx.user.id, body.expectedRevision);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
