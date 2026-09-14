import { randomUUID } from 'crypto';
import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getApplicant } from '@/server/applicant';
import { getOrCreateApplication, DOC_SLOTS } from '@/server/applications';
import { saveDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';
const MAX = 20 * 1024 * 1024;

// Upload one document for a slot (raw file bytes; ?slot=). Replaces any prior file in the
// same slot. Only while the application is editable. Bytes go to PRIVATE storage.
export async function POST(req: Request) {
  const a = await getApplicant();
  if (!a) return Errors.unauthorized();
  const app = await getOrCreateApplication(a.id);
  if (!app) return Errors.unauthorized();
  if (!['DRAFT', 'CHANGES_REQUESTED'].includes(app.status)) return Errors.validation({ _: 'Application is under review; uploads are locked.' });
  const slot = new URL(req.url).searchParams.get('slot') || '';
  if (!DOC_SLOTS.includes(slot)) return Errors.validation({ slot: 'Unknown document slot.' });

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Errors.validation({ _: 'Empty upload.' });
  if (buf.length > MAX) return Errors.validation({ _: 'File too large.' });

  const docId = randomUUID();
  const stored = await saveDocument(app.id, docId, buf);
  if ('error' in stored) return Errors.validation({ file: stored.error });

  // Replace an existing doc in this slot (delete its row; file is overwritten per-slot key
  // only if same id, so also remove the stored bytes of the old one via full cleanup key).
  const prev = await prisma.applicationDocument.findMany({ where: { applicationId: app.id, slot } });
  await prisma.applicationDocument.create({
    data: { id: docId, applicationId: app.id, slot, storageKey: stored.storageKey, mime: stored.mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, scanStatus: 'UNAVAILABLE', decision: 'PENDING', revision: app.revision },
  });
  for (const p of prev) await prisma.applicationDocument.delete({ where: { id: p.id } });
  // scanStatus is recorded UNAVAILABLE (no AV scanner wired) rather than falsely CLEAN.
  return apiOk({ id: docId, slot, mime: stored.mime });
}
