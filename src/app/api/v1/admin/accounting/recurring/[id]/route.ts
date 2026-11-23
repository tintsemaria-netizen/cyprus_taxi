import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// Stop a recurring item (already booked entries stay).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await prisma.ledgerRecurring.updateMany({ where: { id, active: true }, data: { active: false } });
  if (r.count !== 1) return Errors.notFound();
  return apiOk({ ok: true });
}
