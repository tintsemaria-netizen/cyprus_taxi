import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.count({ where: { fleetId: ctx.fleet.id } }),
    prisma.vehicle.count({ where: { fleetId: ctx.fleet.id } }),
  ]);
  return apiOk({ fleet: { id: ctx.fleet.id, name: ctx.fleet.name }, drivers, vehicles });
}
