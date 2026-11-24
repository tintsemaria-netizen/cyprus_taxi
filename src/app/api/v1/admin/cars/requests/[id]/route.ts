import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { adminCarRequest, decideCarRequest } from '@/server/cars';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await adminCarRequest(id);
  return r ? apiOk(r) : Errors.notFound();
}

// APPROVE | RETURN (with a note) | REJECT (with a note)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const { id } = await params;
  const action = body.action === 'APPROVE' || body.action === 'RETURN' || body.action === 'REJECT' ? body.action : null;
  if (!action) return Errors.validation({ action: 'APPROVE, RETURN or REJECT.' });
  const r = await decideCarRequest(id, ctx.user.id, action, typeof body.note === 'string' ? body.note : undefined);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
