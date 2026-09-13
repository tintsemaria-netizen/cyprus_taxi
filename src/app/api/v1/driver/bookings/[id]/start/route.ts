import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { startTrip } from '@/server/dispatch/lifecycle';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let body: { expectedRevision?: number; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (typeof body.expectedRevision !== 'number') return Errors.validation({ expectedRevision: 'Required.' });
  if (typeof body.code !== 'string' || !/^\d{4}$/.test(body.code.trim())) return Errors.validation({ code: 'Enter the passenger’s 4-digit code.' });
  const r = await startTrip(id, ctx.driver.id, body.expectedRevision, body.code);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status, revision: r.revision });
}
