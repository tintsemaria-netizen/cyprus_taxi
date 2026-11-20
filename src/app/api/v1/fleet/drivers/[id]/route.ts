import { apiOk, Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx, fleetHasDriver } from '@/server/fleet';
import { driverHead } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  if (!(await fleetHasDriver(ctx.fleet.id, id))) return Errors.notFound();
  const driver = await driverHead(id);
  return driver ? apiOk({ driver }) : Errors.notFound();
}
