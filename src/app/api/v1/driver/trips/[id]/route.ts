import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverTripDetail } from '@/server/driver/trips';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const detail = await driverTripDetail(ctx.driver.id, id);
  if (!detail) return Errors.notFound('Trip not found or not yours.');
  return apiOk(detail);
}
