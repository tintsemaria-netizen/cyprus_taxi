import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { terminateBooking } from '@/server/assignments';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ expectedRevision: z.number().int().min(0), reason: z.string().min(3).max(500) });

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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ reason: 'A reason (min 3 chars) and expectedRevision are required.' });

  const result = await terminateBooking({
    bookingId: id,
    expectedRevision: parsed.data.expectedRevision,
    actorId: ctx.user.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return apiError(result.status, result.code, result.message);
  return apiOk({ ok: true, status: result.status, revision: result.revision });
}
