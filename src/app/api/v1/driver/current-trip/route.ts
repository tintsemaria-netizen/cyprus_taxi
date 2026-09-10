import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverCurrentTrip } from '@/server/views';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await driverCurrentTrip(ctx.driver.id));
}
