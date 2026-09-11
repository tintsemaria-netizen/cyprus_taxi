import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ driverId: z.string().uuid(), vehicleId: z.string().uuid() });

// Atomic exclusive binding: one current binding per driver and per vehicle.
export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'driverId and vehicleId (uuid) required.' });

  const driver = await prisma.driver.findUnique({ where: { id: parsed.data.driverId } });
  const vehicle = await prisma.vehicle.findUnique({ where: { id: parsed.data.vehicleId } });
  if (!driver || !vehicle) return Errors.notFound('Driver or vehicle not found.');
  let blocked: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Lock driver + vehicle rows (same order as assignment) and re-check for an
      // active trip INSIDE the transaction so binding can't race an assignment.
      await tx.$executeRaw`SELECT 1 FROM "Driver" WHERE id = ${driver.id} FOR UPDATE`;
      await tx.$executeRaw`SELECT 1 FROM "Vehicle" WHERE id = ${vehicle.id} FOR UPDATE`;
      if (await tx.assignment.findFirst({ where: { activeDriverId: driver.id } })) { blocked = 'Driver is on an active trip.'; return; }
      if (await tx.assignment.findFirst({ where: { activeVehicleId: vehicle.id } })) { blocked = 'Vehicle is on an active trip.'; return; }
      // End any current binding for this driver or vehicle.
      await tx.driverVehicleBinding.updateMany({
        where: { OR: [{ activeDriverId: driver.id }, { activeVehicleId: vehicle.id }] },
        data: { endedAt: new Date(), activeDriverId: null, activeVehicleId: null },
      });
      await tx.driverVehicleBinding.create({
        data: { driverId: driver.id, vehicleId: vehicle.id, activeDriverId: driver.id, activeVehicleId: vehicle.id },
      });
      await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'BIND_VEHICLE', target: `${driver.id}:${vehicle.id}` } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return Errors.conflict('Binding changed concurrently. Retry.');
    }
    throw e;
  }
  if (blocked) return Errors.conflict(blocked);
  return apiOk({ ok: true }, 201);
}
