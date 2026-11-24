import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { createCarRequest } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Start adding a new car (details first; documents next).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await createCarRequest(ctx.driver.id, (body.vehicle ?? {}) as Record<string, unknown>);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
