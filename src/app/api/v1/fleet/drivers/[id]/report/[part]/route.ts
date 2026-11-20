import { Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx, fleetHasDriver } from '@/server/fleet';
import { driverReportResponse } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The fleet owner's view of one of HIS drivers' reports — the same tool as the driver's and admin's.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; part: string }> }) {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, part } = await params;
  if (!(await fleetHasDriver(ctx.fleet.id, id))) return Errors.notFound();
  return driverReportResponse(id, part, new URL(req.url));
}
