import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner } from '@/server/accounting';
import { areaOf } from '@/server/staff-log';

export const dynamic = 'force-dynamic';

// How many «Не ваши изменения» are new — the superadmin's menu turns red (2026-11-23).
export async function GET() {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const [unread, last] = await Promise.all([
    prisma.staffAction.count({ where: { seenAt: null } }),
    prisma.staffAction.findFirst({ where: { seenAt: null }, orderBy: { createdAt: 'desc' } }),
  ]);
  // The newest unchecked change — the silent pop-up «Элени изменил · Минимум предзаказа».
  return apiOk({ unread, last: last ? { id: last.id, actor: last.actorName, method: last.method, area: areaOf(last.path) } : null });
}
