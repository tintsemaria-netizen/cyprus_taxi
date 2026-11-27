import { apiOk, Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx, fleetHasDriver } from '@/server/fleet';
import { reliabilityView } from '@/server/reports/reliability-view';

export const dynamic = 'force-dynamic';

// The fleet owner's driver card: «Рейтинг и надёжность» (2026-11-27), only for his own drivers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  if (!(await fleetHasDriver(ctx.fleet.id, id))) return Errors.notFound();
  const v = await reliabilityView(id);
  return v ? apiOk(v) : Errors.notFound();
}
