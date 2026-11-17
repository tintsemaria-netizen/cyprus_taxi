import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { invalidateFixedFareCache, parsePolygon, zoneSchema } from '@/server/fixed-fares';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const parsed = zoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'Invalid zone: name, airport, at least 3 points and prices are required.' });
  const exists = await prisma.fixedFareZone.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return Errors.notFound();
  const row = await prisma.fixedFareZone.update({ where: { id }, data: { ...parsed.data, active: parsed.data.active ?? true } });
  invalidateFixedFareCache();
  console.log(`[fixed-fares] zone ${id} updated by staff ${ctx.user.id}`);
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  await prisma.fixedFareZone.deleteMany({ where: { id } });
  invalidateFixedFareCache();
  console.log(`[fixed-fares] zone ${id} deleted by staff ${ctx.user.id}`);
  return apiOk({ deleted: true });
}
