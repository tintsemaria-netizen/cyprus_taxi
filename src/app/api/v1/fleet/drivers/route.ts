import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';
import { driverFigures } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The owner's drivers with today + this week figures (the same tool as the admin's list).
export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const drivers = await prisma.driver.findMany({
    where: { fleetId: ctx.fleet.id },
    include: { user: true, bindings: { where: { endedAt: null }, include: { vehicle: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const figures = await driverFigures(drivers.map((d) => d.id));
  return apiOk({
    drivers: drivers.map((d) => ({
      id: d.id, login: d.user.login, publicName: d.publicName, phone: d.phone,
      active: d.active && d.user.active, onDuty: d.onDuty,
      vehicle: d.bindings[0] ? { plate: d.bindings[0].vehicle.plate, label: `${d.bindings[0].vehicle.make} ${d.bindings[0].vehicle.model}` } : null,
    })),
    figures,
  });
}
