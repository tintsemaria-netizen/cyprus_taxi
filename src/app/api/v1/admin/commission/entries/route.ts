import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { recordManualEntry, type ManualKind } from '@/server/commission';

export const dynamic = 'force-dynamic';

// Launch fixes §9: admin records a payment the driver actually made, a credit or a write-off.
export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { driverId?: string; kind?: string; amountCents?: number; reference?: string; note?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (!body.driverId || !['PAYMENT', 'CREDIT', 'WRITE_OFF'].includes(body.kind || '')) return Errors.validation({ kind: 'PAYMENT, CREDIT or WRITE_OFF.' });
  const r = await recordManualEntry({ driverId: body.driverId, kind: body.kind as ManualKind, amountCents: Number(body.amountCents), reference: body.reference || '', note: body.note, staffId: ctx.user.id });
  if (!r.ok) return apiError(422, r.code, r.message);
  return apiOk({ ok: true, duplicate: r.duplicate });
}
