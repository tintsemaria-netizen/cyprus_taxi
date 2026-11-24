import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { adminCarQueue, decideAccess } from '@/server/cars';

export const dynamic = 'force-dynamic';

// «Машины» (2026-11-24): drivers asking for a car the admin decides on, and new cars to check.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await adminCarQueue());
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await decideAccess(String(body.id ?? ''), { kind: 'ADMIN', userId: ctx.user.id }, body.yes === true);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
