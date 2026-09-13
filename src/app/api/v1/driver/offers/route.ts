import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { getDriverActiveOffer } from '@/server/dispatch/offers';

export const dynamic = 'force-dynamic';

// The driver's current live dispatch offer (if any). Polled by the driver app.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ offer: await getDriverActiveOffer(ctx.driver.id) });
}
