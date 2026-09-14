import { Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { readDocument } from '@/server/storage';
export const dynamic = 'force-dynamic';
// Stream a KYC document to a reviewer (ADMIN only; never a public URL).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const ctx = await requireStaff(['ADMIN']); if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, docId } = await params;
  const doc = await prisma.applicationDocument.findFirst({ where: { id: docId, applicationId: id } });
  if (!doc) return Errors.notFound();
  const buf = await readDocument(doc.storageKey);
  if (!buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': doc.mime, 'Cache-Control': 'private, no-store' } });
}
