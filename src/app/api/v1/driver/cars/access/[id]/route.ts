import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { decideAccess } from '@/server/cars';

export const dynamic = 'force-dynamic';

// The owner of a car says yes / no to another driver working on it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const { id } = await params;
  const r = await decideAccess(id, { kind: 'OWNER', driverId: ctx.driver.id }, body.yes === true);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
