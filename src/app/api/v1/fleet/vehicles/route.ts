import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';

export const dynamic = 'force-dynamic';

// The owner's cars and who drives each now (read-only).
export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const vehicles = await prisma.vehicle.findMany({
    where: { fleetId: ctx.fleet.id },
    include: { bindings: { where: { endedAt: null }, include: { driver: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return apiOk({
    vehicles: vehicles.map((v) => ({
      id: v.id, plate: v.plate, make: v.make, model: v.model, color: v.color, vClass: v.vClass, seats: v.seats, active: v.active,
      driver: v.bindings[0] ? { id: v.bindings[0].driver.id, publicName: v.bindings[0].driver.publicName, onDuty: v.bindings[0].driver.onDuty } : null,
    })),
  });
}
