import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { listFreeOrders } from '@/server/dispatch/free-orders';

export const dynamic = 'force-dynamic';

// Rides automatic dispatch could not place (NO_DRIVER, recent) that this driver's vehicle fits.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ orders: await listFreeOrders(ctx.driver.id) });
}
