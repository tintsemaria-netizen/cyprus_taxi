import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parsePolygon } from '@/server/fixed-fares';
import { invalidateMinFareCache, minZoneData, minZoneSchema } from '@/server/min-fares';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const parsed = minZoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'Name, Comfort and XL prices and at least 3 corners are required.' });
  if (!(await prisma.minFareZone.findUnique({ where: { id }, select: { id: true } }))) return Errors.notFound();
  const row = await prisma.minFareZone.update({ where: { id }, data: minZoneData(parsed.data) });
  invalidateMinFareCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'MIN_FARE_ZONE_UPDATED', target: id, detail: `${row.name} C${row.comfortCents} XL${row.xlCents} ${row.active ? 'on' : 'off'}` } });
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  await prisma.minFareZone.deleteMany({ where: { id } });
  invalidateMinFareCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'MIN_FARE_ZONE_DELETED', target: id } });
  return apiOk({ deleted: true });
}
