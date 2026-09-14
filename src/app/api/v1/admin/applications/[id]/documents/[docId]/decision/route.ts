import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { setDocumentDecision } from '@/server/applications';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, docId } = await params;
  let body: { decision?: string; note?: string; expiresAt?: string }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (body.decision !== 'ACCEPTED' && body.decision !== 'CHANGES') return Errors.validation({ decision: 'ACCEPTED or CHANGES.' });
  const r = await setDocumentDecision(id, docId, body.decision, body.note, ctx.user.id, body.expiresAt);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
