import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverCancelPrePickup } from '@/server/dispatch/lifecycle';

export const dynamic = 'force-dynamic';

// Driver releases a pre-pickup trip → automatic rematch (not a terminal cancel).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { expectedRevision?: number; reason?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (typeof body.expectedRevision !== 'number') return Errors.validation({ expectedRevision: 'Required.' });
  const r = await driverCancelPrePickup(id, ctx.driver.id, body.expectedRevision, body.reason);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status, revision: r.revision });
}
