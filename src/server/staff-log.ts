import { prisma } from '@/lib/db';
import type { StaffUser } from '@prisma/client';

// «Не ваши изменения» (2026-11-23, operator): every changing API call by an admin who is not the owner
// is logged. No push and no sound (operator: «не уведомление со звуком») — the superadmin's menu item
// turns red until he opens the section.
export async function logStaffChange(user: StaffUser, mutation: string): Promise<void> {
  const [method, path] = mutation.split(' ', 2);
  if (!method || !path) return;
  try {
    await prisma.staffAction.create({ data: { actorId: user.id, actorName: user.displayName, actorRole: user.role, method, path } });
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
