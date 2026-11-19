import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { markFixedPaymentReceived } from '@/server/driver/settlement';

export const dynamic = 'force-dynamic';

// Launch fixes §6: the completing driver confirms the passenger paid a fixed-price ride.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await markFixedPaymentReceived(ctx.driver.id, id);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true });
}
