import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverShareNoShow } from '@/server/dispatch/lifecycle';

export const dynamic = 'force-dynamic';

// Shared ride: the passenger of this leg did not come (Task 022).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { expectedRevision?: number };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (typeof body.expectedRevision !== 'number') return Errors.validation({ expectedRevision: 'Required.' });
  const r = await driverShareNoShow(id, ctx.driver.id, body.expectedRevision);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status, revision: r.revision, ...(r.extra ?? {}) });
}
