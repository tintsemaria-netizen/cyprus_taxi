import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { deleteApplicationFiles, deleteDocumentFile, listStoredFiles } from '@/server/storage';

// KYC document retention (2026-10-01 audit, Stage 1.12; GDPR Art. 5(1)(e)). Copies of identity
// documents must not be kept without a purpose:
//  - REJECTED applications: files deleted KYC_REJECTED_RETENTION_DAYS after the decision;
//  - abandoned DRAFT / CHANGES_REQUESTED applications: deleted after KYC_DRAFT_RETENTION_DAYS idle;
//  - orphan files (no ApplicationDocument row points at them) older than a day: deleted.
// Document METADATA rows stay (audit trail); a FILES_PURGED application event records each purge.
// Approved drivers' documents are kept (needed for expiry enforcement and compliance).

export interface KycRetentionResult { applicationsPurged: number; orphansDeleted: number }

export async function runKycRetention(now: Date = new Date()): Promise<KycRetentionResult> {
  const day = 86_400_000;
  const rejectedBefore = new Date(now.getTime() - config.kyc.rejectedRetentionDays * day);
  const draftBefore = new Date(now.getTime() - config.kyc.draftRetentionDays * day);

  const due = await prisma.driverApplication.findMany({
    where: {
      OR: [
        { status: 'REJECTED', reviewedAt: { lt: rejectedBefore } },
        { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] }, updatedAt: { lt: draftBefore } },
      ],
      documents: { some: {} },
      NOT: { events: { some: { type: 'FILES_PURGED' } } },
    },
    select: { id: true, status: true, revision: true },
    take: 50,
  });
  for (const a of due) {
    await deleteApplicationFiles(a.id);
    await prisma.applicationEvent.create({
      data: { applicationId: a.id, type: 'FILES_PURGED', actorType: 'SYSTEM', visibility: 'INTERNAL', revision: a.revision, detail: a.status === 'REJECTED' ? `rejected > ${config.kyc.rejectedRetentionDays}d` : `inactive > ${config.kyc.draftRetentionDays}d` },
    });
  }

  // Orphan sweep: files no document row references (legacy replaced/infected uploads).
  const files = await listStoredFiles();
  let orphansDeleted = 0;
  if (files.length) {
    const known = new Set((await prisma.applicationDocument.findMany({ select: { storageKey: true } })).map((d) => d.storageKey));
    for (const f of files) {
      if (known.has(f.storageKey)) continue;
      if (now.getTime() - f.mtime.getTime() < day) continue; // upload in flight
      await deleteDocumentFile(f.storageKey);
      orphansDeleted++;
    }
  }
  return { applicationsPurged: due.length, orphansDeleted };
}
