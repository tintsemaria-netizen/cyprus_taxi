import { apiOk, apiError, Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';
import { fleetCarQueue, decideAccess, revokeAccess, fleetGranted } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Drivers asking to work on a fleet car — the fleet owner decides (2026-11-24).
export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ items: await fleetCarQueue(ctx.fleet.id), granted: await fleetGranted(ctx.fleet.id) });
}

export async function POST(req: Request) {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const who = { kind: 'FLEET' as const, fleetId: ctx.fleet.id, userId: ctx.user.id };
  const r = body.revoke === true ? await revokeAccess(String(body.id ?? ''), who) : await decideAccess(String(body.id ?? ''), who, body.yes === true);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
