import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { statusSchema, zodFieldErrors } from '@/lib/validation';
import { changeStatus } from '@/server/assignments';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN', 'DISPATCHER']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  const result = await changeStatus({
    bookingId: id,
    to: parsed.data.to,
    expectedRevision: parsed.data.expectedRevision,
    actor: 'STAFF',
    actorId: ctx.user.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
