import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { findDuplicateVehicle } from '@/server/vehicle-dupes';
import { vehicleSchema, zodFieldErrors } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const vehicles = await prisma.vehicle.findMany({
    include: { bindings: { where: { endedAt: null }, include: { driver: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return apiOk({
    vehicles: vehicles.map((v) => ({
      id: v.id, plate: v.plate, make: v.make, model: v.model, color: v.color,
      vClass: v.vClass, seats: v.seats, active: v.active, fleetId: v.fleetId,
      boundDriver: v.bindings[0] ? v.bindings[0].driver.publicName : null,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = vehicleSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  // «KXY 248» = «KXY248» (2026-11-24): one car, one vehicle row — or two drivers could be online in it.
  if (await findDuplicateVehicle({ plate: parsed.data.plate })) return apiError(409, 'DUPLICATE_VEHICLE', 'A vehicle with that plate already exists.');

  const v = await prisma.vehicle.create({ data: { ...parsed.data, active: true } });
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'CREATE_VEHICLE', target: v.id } });
  return apiOk({ id: v.id }, 201);
}
