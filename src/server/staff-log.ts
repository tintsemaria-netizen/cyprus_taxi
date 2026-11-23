import { prisma } from '@/lib/db';
import { enqueue } from '@/server/outbox';
import type { StaffUser } from '@prisma/client';

// «Журнал изменений» (2026-11-23, operator: «не подтверждение, а уведомление — все изменения с
// уведомлением суперадмину»). Every changing API call by an admin who is not the owner is logged;
// the owner gets a push (at most one per admin per 2 minutes, so a burst of edits rings once).
const PUSH_GAP_MS = 2 * 60_000;

export async function logStaffChange(user: StaffUser, mutation: string): Promise<void> {
  const [method, path] = mutation.split(' ', 2);
  if (!method || !path) return;
  try {
    const recent = await prisma.staffAction.findFirst({ where: { actorId: user.id, createdAt: { gte: new Date(Date.now() - PUSH_GAP_MS) } }, select: { id: true } });
    await prisma.staffAction.create({ data: { actorId: user.id, actorName: user.displayName, actorRole: user.role, method, path } });
    if (recent) return;
    const owners = await prisma.staffUser.findMany({ where: { isOwner: true, active: true }, select: { id: true } });
    for (const o of owners) {
      await enqueue(prisma, {
        audience: `STAFF:${o.id}`, title: 'Change in the admin panel', body: `${user.displayName} made a change — open the change log.`,
        url: '/admin/changes', tag: 'staff-changes', msg: { k: 'staff.change', p: { name: user.displayName } },
      });
    }
  } catch { /* never block the admin's request because of the log */ }
}

/** What part of the system a path belongs to — the label key in staff.nav. */
export function areaOf(path: string): string {
  const p = path.replace(/^\/api\/v1\//, '');
  const map: [RegExp, string][] = [
    [/^admin\/drivers/, 'drivers'], [/^admin\/vehicle/, 'vehicles'], [/^admin\/fleets/, 'fleets'],
    [/^admin\/fixed-zones/, 'fixedPrices'], [/^admin\/min-fares/, 'minFares'], [/^admin\/settings/, 'settings'],
    [/^admin\/passengers/, 'passengers'], [/^admin\/applications/, 'applications'], [/^admin\/staff/, 'staff'],
    [/^admin\/accounting/, 'accounting'], [/^(admin\/)?dispatch|^bookings|^admin\/bookings/, 'dispatch'],
  ];
  for (const [re, k] of map) if (re.test(p)) return k;
  return 'misc';
}
