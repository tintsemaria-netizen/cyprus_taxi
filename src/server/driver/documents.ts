import { prisma } from '@/lib/db';

// Driver documents view (Task 017 §6). Shows STATUS only — never internal reviewer notes, document
// numbers, or scan bytes. LEGACY drivers (pre-onboarding) have no application documents; that is
// reported as an honest unavailable state, not an empty list pretending everything is fine.

export type DocStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNDER_REVIEW' | 'ACTION_NEEDED';

export interface DriverDocument { slot: string; status: DocStatus; expiresAt: string | null }

function statusOf(d: { decision: string; expiresAt: Date | null }, now: number): DocStatus {
  if (d.decision === 'CHANGES') return 'ACTION_NEEDED';
  if (d.decision === 'PENDING') return 'UNDER_REVIEW';
  if (d.expiresAt) {
    if (d.expiresAt.getTime() < now) return 'EXPIRED';
    if (d.expiresAt.getTime() < now + 14 * 86_400_000) return 'EXPIRING';
  }
  return 'VALID';
}

export async function driverDocuments(driver: { applicationId: string | null }): Promise<{ available: boolean; note?: string; documents: DriverDocument[] }> {
  if (!driver.applicationId) {
    return { available: false, note: 'Your account predates in-app documents; document checks are handled by the operator.', documents: [] };
  }
  const docs = await prisma.applicationDocument.findMany({ where: { applicationId: driver.applicationId }, orderBy: { slot: 'asc' }, select: { slot: true, decision: true, expiresAt: true } });
  const now = Date.now();
  return { available: true, documents: docs.map((d) => ({ slot: d.slot, status: statusOf(d, now), expiresAt: d.expiresAt?.toISOString() ?? null })) };
}
