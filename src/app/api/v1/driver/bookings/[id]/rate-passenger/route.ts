import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { ratePassenger } from '@/server/trip-close';

export const dynamic = 'force-dynamic';

// The driver rates the passenger 1–5 stars after the ride (once).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { stars?: unknown; comment?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await ratePassenger(id, ctx.driver.id, Number(body.stars), typeof body.comment === 'string' ? body.comment : null);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true });
}
