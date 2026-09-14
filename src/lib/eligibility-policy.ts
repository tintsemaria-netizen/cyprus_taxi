import type { Prisma } from '@prisma/client';

// Operational eligibility (Task 015): only a grandfathered LEGACY driver or an admin-
// APPROVED driver may work. PENDING / SUSPENDED / DOCUMENTS_EXPIRED are blocked from all
// new work (duty, fleet exposure, candidacy, offers, manual assignment).
export const WORK_ELIGIBLE = ['LEGACY', 'APPROVED'] as const;

export function canWork(d: { eligibility: string; active: boolean }): boolean {
  return d.active && (WORK_ELIGIBLE as readonly string[]).includes(d.eligibility);
}

// Prisma filter fragment to include only work-eligible drivers.
export const eligibleDriverWhere: Prisma.DriverWhereInput = { eligibility: { in: [...WORK_ELIGIBLE] } };
