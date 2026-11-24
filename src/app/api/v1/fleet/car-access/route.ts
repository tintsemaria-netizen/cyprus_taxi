import { apiOk, apiError, Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';
import { fleetCarQueue, decideAccess } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Drivers asking to work on a fleet car — the fleet owner decides (2026-11-24).
export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ items: await fleetCarQueue(ctx.fleet.id) });
}

export async function POST(req: Request) {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await decideAccess(String(body.id ?? ''), { kind: 'FLEET', fleetId: ctx.fleet.id, userId: ctx.user.id }, body.yes === true);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
