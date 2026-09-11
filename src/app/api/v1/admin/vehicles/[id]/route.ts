import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  make: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
  color: z.string().min(1).max(30).optional(),
  seats: z.number().int().min(1).max(16).optional(),
  vClass: z.enum(['COMFORT', 'XL']).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'Invalid fields.' });

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) return Errors.notFound();

  // Deactivating a vehicle with an active assignment is blocked (must reassign first).
  // Lock + re-check inside a transaction so it can't race a concurrent assignment.
  let blocked = false;
  await prisma.$transaction(async (tx) => {
    if (parsed.data.active === false) {
      await tx.$executeRaw`SELECT 1 FROM "Vehicle" WHERE id = ${id} FOR UPDATE`;
      if (await tx.assignment.findFirst({ where: { activeVehicleId: id } })) { blocked = true; return; }
    }
    await tx.vehicle.update({ where: { id }, data: parsed.data });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'UPDATE_VEHICLE', target: id } });
  });
  if (blocked) return Errors.conflict('Vehicle has an active assignment; reassign it first.');
  return apiOk({ ok: true });
}
