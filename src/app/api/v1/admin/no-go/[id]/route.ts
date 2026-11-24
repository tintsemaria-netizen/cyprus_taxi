import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parsePolygon } from '@/server/fixed-fares';
import { invalidateNoGoCache, noGoSchema } from '@/server/no-go';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const parsed = noGoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'A name and at least 3 corners are required.' });
  if (!(await prisma.noGoZone.findUnique({ where: { id }, select: { id: true } }))) return Errors.notFound();
  const row = await prisma.noGoZone.update({ where: { id }, data: { name: parsed.data.name, polygon: parsed.data.polygon, active: parsed.data.active ?? true } });
  invalidateNoGoCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'NO_GO_ZONE_UPDATED', target: id, detail: `${row.name} ${row.active ? 'on' : 'off'}` } });
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  await prisma.noGoZone.deleteMany({ where: { id } });
  invalidateNoGoCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'NO_GO_ZONE_DELETED', target: id } });
  return apiOk({ deleted: true });
}
