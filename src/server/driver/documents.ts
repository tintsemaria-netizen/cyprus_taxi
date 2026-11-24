import { prisma } from '@/lib/db';
import { slotStates, WARN_DAYS } from '@/server/doc-renewal';

// Driver documents view (Task 017 §6). Shows STATUS only — never internal reviewer notes, document
// numbers, or scan bytes. LEGACY drivers (pre-onboarding) have no application documents; that is
// reported as an honest unavailable state, not an empty list pretending everything is fine.

export type DocStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNDER_REVIEW' | 'ACTION_NEEDED';

export interface DriverDocument {
  slot: string; status: DocStatus; expiresAt: string | null;
  /** Licence, taxi licence, insurance, roadworthiness: the driver uploads the new one himself (2026-11-24). */
  canRenew: boolean;
  /** A new document he uploaded: waiting for the operator, or sent back with the operator's note. */
  renewal: { status: 'UNDER_REVIEW' | 'ACTION_NEEDED'; uploadedAt: string; note: string | null } | null;
  /** Whole days left on the accepted document (negative = expired). */
  daysLeft: number | null;
}

function statusOf(d: { decision: string; expiresAt: Date | null }, now: number): DocStatus {
  if (d.decision === 'CHANGES') return 'ACTION_NEEDED';
  if (d.decision === 'PENDING') return 'UNDER_REVIEW';
  if (d.expiresAt) {
    if (d.expiresAt.getTime() < now) return 'EXPIRED';
    if (d.expiresAt.getTime() < now + WARN_DAYS * 86_400_000) return 'EXPIRING';
  }
  return 'VALID';
}

export async function driverDocuments(driver: { applicationId: string | null }): Promise<{ available: boolean; note?: string; documents: DriverDocument[] }> {
  if (!driver.applicationId) {
    return { available: false, note: 'Your account predates in-app documents; document checks are handled by the operator.', documents: [] };
  }
  const rows = await prisma.applicationDocument.findMany({ where: { applicationId: driver.applicationId }, orderBy: { createdAt: 'desc' }, select: { id: true, slot: true, decision: true, scanStatus: true, expiresAt: true, createdAt: true, decisionNote: true } });
  const now = new Date();
  const states = new Map(slotStates(rows, now).map((s) => [s.slot, s]));
  const seen = new Set<string>();
  const documents: DriverDocument[] = [];
  for (const r of rows) {
    if (seen.has(r.slot)) continue; // newest per slot
    if (r.slot === 'roadworthiness') continue; // not asked for any more (operator 2026-11-24)
    seen.add(r.slot);
    const st = states.get(r.slot);
    if (st?.accepted) {
      const acc = rows.find((x) => x.id === st.accepted!.id)!;
      const ren = st.renewal ? { status: (st.renewal.decision === 'PENDING' ? 'UNDER_REVIEW' : 'ACTION_NEEDED') as 'UNDER_REVIEW' | 'ACTION_NEEDED', uploadedAt: st.renewal.createdAt.toISOString(), note: st.renewal.decision === 'CHANGES' ? st.renewal.note : null } : null;
      documents.push({ slot: r.slot, status: statusOf(acc, now.getTime()), expiresAt: acc.expiresAt?.toISOString() ?? null, canRenew: true, renewal: ren, daysLeft: st.daysLeft });
    } else {
      documents.push({ slot: r.slot, status: statusOf(r, now.getTime()), expiresAt: r.expiresAt?.toISOString() ?? null, canRenew: false, renewal: null, daysLeft: null });
    }
  }
  documents.sort((a, b) => a.slot.localeCompare(b.slot));
  return { available: true, documents };
}
