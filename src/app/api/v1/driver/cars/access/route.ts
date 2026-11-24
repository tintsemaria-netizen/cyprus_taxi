import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { requestAccess } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Ask to work on a car that is already in the system (by plate).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await requestAccess(ctx.driver.id, String(body.plate ?? ''));
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
