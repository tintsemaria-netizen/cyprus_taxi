import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { reportSettlement, currentSettlement, settlementHistory } from '@/server/driver/settlement';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Driver-reported settlement for a completed trip. GET returns current + history; POST reports or
// corrects (correction requires a reason + expectedRevision). Only the completing driver is allowed
// — enforced in the server module by the completed-assignment attribution.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  // Authorize: this driver must have completed the trip.
  const asg = await prisma.assignment.findFirst({ where: { bookingId: id, reason: 'completed' }, orderBy: { endedAt: 'desc' }, select: { driverId: true } });
  if (!asg || asg.driverId !== ctx.driver.id) return Errors.forbidden();
  return apiOk({ current: await currentSettlement(id), history: await settlementHistory(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { reportedFinalCents?: number; paymentReceived?: boolean; note?: string; correctionReason?: string; expectedRevision?: number };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (typeof body.reportedFinalCents !== 'number') return Errors.validation({ reportedFinalCents: 'Required (integer cents).' });
  const r = await reportSettlement(ctx.driver.id, id, {
    reportedFinalCents: body.reportedFinalCents,
    paymentReceived: body.paymentReceived,
    note: body.note,
    correctionReason: body.correctionReason,
    expectedRevision: body.expectedRevision,
  });
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, settlement: r.settlement });
}
