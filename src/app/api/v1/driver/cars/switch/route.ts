import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { switchCar } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Change the car he works on — only offline, no ride (2026-11-24).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await switchCar(ctx.driver.id, String(body.vehicleId ?? ''));
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
