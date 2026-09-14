import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { statusSchema, zodFieldErrors } from '@/lib/validation';
import { changeStatus } from '@/server/assignments';
import { staffMarkArrived, staffStartTrip, staffCompleteTrip } from '@/server/dispatch/lifecycle';

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
  const { to, expectedRevision, reason } = parsed.data;
  const staffId = ctx.user.id;
  const role = ctx.user.role;

  // Protected lifecycle transitions go through the SAME validated finalizers as the
  // driver path, as an audited override (reason required). Everything else (EN_ROUTE,
  // CANCELED, retry) uses the generic state machine.
  const result =
    to === 'ARRIVED' ? await staffMarkArrived(id, expectedRevision, staffId, role, reason ?? '')
    : to === 'IN_PROGRESS' ? await staffStartTrip(id, expectedRevision, staffId, role, reason ?? '')
    : to === 'COMPLETED' ? await staffCompleteTrip(id, expectedRevision, staffId, role, reason ?? '')
    : await changeStatus({ bookingId: id, to, expectedRevision, actor: 'STAFF', actorId: staffId, reason });

  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
