import { Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

// The driver's own photo for the «визитка» at the top of his menu (2026-11-26, operator): his
// selfie from the application — the accepted one, else the latest he uploaded. Only to himself.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  if (!ctx.driver.applicationId) return Errors.notFound();
  const docs = await prisma.applicationDocument.findMany({
    where: { applicationId: ctx.driver.applicationId, slot: 'selfie', mime: { startsWith: 'image/' } },
    orderBy: { createdAt: 'desc' }, select: { storageKey: true, mime: true, decision: true },
  });
  const doc = docs.find((d) => d.decision === 'ACCEPTED') ?? docs[0];
  const buf = doc ? await readDocument(doc.storageKey) : null;
  if (!doc || !buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': doc.mime, 'Cache-Control': 'private, max-age=600', 'Content-Disposition': 'inline' } });
}
