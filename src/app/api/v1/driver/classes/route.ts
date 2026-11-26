import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { prisma } from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// «Заказы Comfort & XL» (2026-11-25 / 2026-11-26, operator): an XL car takes XL and Comfort orders; its driver
// switches each on or off. At least one stays on.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const [d, b] = await Promise.all([
    prisma.driver.findUnique({ where: { id: ctx.driver.id }, select: { takesComfort: true, takesXl: true } }),
    prisma.driverVehicleBinding.findFirst({ where: { driverId: ctx.driver.id, endedAt: null }, select: { vehicle: { select: { vClass: true } } } }),
  ]);
  return apiOk({ vClass: b?.vehicle.vClass ?? null, takesComfort: d?.takesComfort ?? true, takesXl: d?.takesXl ?? true });
}

const schema = z.object({ takesComfort: z.boolean().optional(), takesXl: z.boolean().optional() });
export async function PATCH(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Errors.validation({ takesComfort: 'Must be a boolean.' });
  const cur = await prisma.driver.findUnique({ where: { id: ctx.driver.id }, select: { takesComfort: true, takesXl: true } });
  const next = { takesComfort: p.data.takesComfort ?? cur?.takesComfort ?? true, takesXl: p.data.takesXl ?? cur?.takesXl ?? true };
  if (!next.takesComfort && !next.takesXl) return Errors.validation({ takesXl: 'Keep at least one class on.' });
  await prisma.driver.update({ where: { id: ctx.driver.id }, data: next });
  return apiOk(next);
}
