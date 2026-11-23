import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner } from '@/server/accounting';
import { areaOf } from '@/server/staff-log';

export const dynamic = 'force-dynamic';

// «Журнал изменений» — owner only (2026-11-23).
export async function GET(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const before = new URL(req.url).searchParams.get('before');
  const rows = await prisma.staffAction.findMany({ where: before ? { createdAt: { lt: new Date(before) } } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  const unread = await prisma.staffAction.count({ where: { seenAt: null } });
  return apiOk({
    unread,
    actions: rows.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), actor: a.actorName, method: a.method, area: areaOf(a.path), path: a.path, seen: !!a.seenAt })),
  });
}

// POST — mark everything as seen.
export async function POST() {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  await prisma.staffAction.updateMany({ where: { seenAt: null }, data: { seenAt: new Date() } });
  return apiOk({ ok: true });
}
