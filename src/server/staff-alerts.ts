import { prisma } from '@/lib/db';
import type { StaffUser } from '@prisma/client';

/** Driver applications waiting for an admin (submitted or being reviewed) — «Заявки» is red (2026-11-23). */
export const PENDING_APPLICATION = ['SUBMITTED', 'IN_REVIEW'] as const;

/** What makes the admin menu red: waiting applications (every admin) and unchecked changes (owner only). */
export async function staffAlerts(user: StaffUser) {
  if (user.role !== 'ADMIN') return { applications: 0, changes: 0, last: null };
  const owner = user.isOwner;
  const [applications, changes, last] = await Promise.all([
    prisma.driverApplication.count({ where: { status: { in: [...PENDING_APPLICATION] } } }),
    owner ? prisma.staffAction.count({ where: { seenAt: null } }) : 0,
    owner ? prisma.staffAction.findFirst({ where: { seenAt: null }, orderBy: { createdAt: 'desc' } }) : null,
  ]);
  return { applications, changes, last };
}
