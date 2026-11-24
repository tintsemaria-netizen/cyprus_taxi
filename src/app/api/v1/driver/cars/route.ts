import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { myCars } from '@/server/cars';

export const dynamic = 'force-dynamic';

// «Мои машины» (2026-11-24): the cars he may work on, his requests, and others asking for his car.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await myCars(ctx.driver.id));
}
