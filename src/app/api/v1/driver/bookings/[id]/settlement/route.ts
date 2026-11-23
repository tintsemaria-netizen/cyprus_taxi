import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { currentSettlement, settlementHistory } from '@/server/driver/settlement';
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

// Operator 2026-11-24: the amount is fixed when the driver presses «Завершить» (he may change a meter
// ride's amount on that screen only). After completion nothing can be changed.
export async function POST() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiError(409, 'AMOUNT_LOCKED', 'The amount was fixed when the ride was completed and cannot be changed.');
}
