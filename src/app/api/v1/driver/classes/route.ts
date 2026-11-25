import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { prisma } from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// «Брать заказы Comfort» (2026-11-25, operator): an XL car takes Comfort orders too; its driver can switch that off.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const [d, b] = await Promise.all([
    prisma.driver.findUnique({ where: { id: ctx.driver.id }, select: { takesComfort: true } }),
    prisma.driverVehicleBinding.findFirst({ where: { driverId: ctx.driver.id, endedAt: null }, select: { vehicle: { select: { vClass: true } } } }),
  ]);
  return apiOk({ vClass: b?.vehicle.vClass ?? null, takesComfort: d?.takesComfort ?? true });
}

const schema = z.object({ takesComfort: z.boolean() });
export async function PATCH(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Errors.validation({ takesComfort: 'Must be a boolean.' });
  await prisma.driver.update({ where: { id: ctx.driver.id }, data: { takesComfort: p.data.takesComfort } });
  return apiOk({ takesComfort: p.data.takesComfort });
}
