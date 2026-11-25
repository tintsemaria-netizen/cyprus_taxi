import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// «Стоянки с очередью» (2026-11-25) — the queue of each stand right now, first first (admin only).
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rows = await prisma.standQueue.findMany({ orderBy: [{ enteredAt: 'asc' }, { driverId: 'asc' }] });
  const drivers = await prisma.driver.findMany({
    where: { id: { in: rows.map((r) => r.driverId) } },
    select: { id: true, publicName: true, bindings: { where: { endedAt: null }, select: { vehicle: { select: { plate: true } } } } },
  });
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const queues: Record<string, { driverId: string; name: string; plate: string | null; since: string }[]> = {};
  for (const r of rows) {
    const d = byId.get(r.driverId);
    (queues[r.standId] ??= []).push({ driverId: r.driverId, name: d?.publicName ?? '—', plate: d?.bindings[0]?.vehicle.plate ?? null, since: r.enteredAt.toISOString() });
  }
  return apiOk({ queues });
}
