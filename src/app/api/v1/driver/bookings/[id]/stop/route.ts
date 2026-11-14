import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverStopAction, type StopAction } from '@/server/dispatch/lifecycle';

export const dynamic = 'force-dynamic';

// Intermediate stop actions during the trip (2026-11-15): arrived | wait | continue.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { action?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (body.action !== 'arrived' && body.action !== 'wait' && body.action !== 'continue') return Errors.validation({ action: 'Use arrived, wait or continue.' });
  const r = await driverStopAction(id, ctx.driver.id, body.action as StopAction);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status, revision: r.revision });
}
