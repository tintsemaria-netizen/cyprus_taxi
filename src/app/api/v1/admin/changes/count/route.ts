import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// How many «Не ваши изменения» are new — the superadmin's menu turns red (2026-11-23).
export async function GET() {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk({ unread: await prisma.staffAction.count({ where: { seenAt: null } }) });
}
