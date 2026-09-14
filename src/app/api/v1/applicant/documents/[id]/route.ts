import { Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getApplicant } from '@/server/applicant';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

// Stream an applicant's OWN document (authenticated; never a public URL).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await getApplicant();
  if (!a) return Errors.unauthorized();
  const { id } = await params;
  const app = await prisma.driverApplication.findUnique({ where: { applicantId: a.id }, select: { id: true } });
  const doc = app ? await prisma.applicationDocument.findFirst({ where: { id, applicationId: app.id } }) : null;
  if (!doc) return Errors.forbidden();
  const buf = await readDocument(doc.storageKey);
  if (!buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': doc.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } });
}
