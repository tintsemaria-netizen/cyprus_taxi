import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { assignSchema, zodFieldErrors } from '@/lib/validation';
import { assignBooking } from '@/server/assignments';

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
  const parsed = assignSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  const result = await assignBooking({
    bookingId: id,
    driverId: parsed.data.driverId,
    vehicleId: parsed.data.vehicleId,
    expectedRevision: parsed.data.expectedRevision,
    actorId: ctx.user.id,
    acknowledgeNoGps: parsed.data.acknowledgeNoGps,
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
