import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner } from '@/server/accounting';
import { saveLedgerReceipt, readDocument, deleteDocumentFile } from '@/server/storage';

export const dynamic = 'force-dynamic';

// A receipt (photo or PDF) for one entry — owner only, private storage, served only to the owner.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const e = await prisma.ledgerEntry.findFirst({ where: { id, deletedAt: null } });
  if (!e) return Errors.notFound();
  let file: File | null = null;
  try { const f = (await req.formData()).get('file'); file = f instanceof File ? f : null; } catch { /* not multipart */ }
  if (!file) return Errors.validation({ file: 'Choose a photo or PDF.' });
  const saved = await saveLedgerReceipt(e.id, Buffer.from(await file.arrayBuffer()));
  if ('error' in saved) return Errors.validation({ file: saved.error });
  if (e.receiptKey && e.receiptKey !== saved.storageKey) await deleteDocumentFile(e.receiptKey);
  await prisma.ledgerEntry.update({ where: { id }, data: { receiptKey: saved.storageKey, receiptMime: saved.mime } });
  return apiOk({ ok: true });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const e = await prisma.ledgerEntry.findFirst({ where: { id, deletedAt: null } });
  if (!e?.receiptKey) return Errors.notFound();
  const buf = await readDocument(e.receiptKey);
  if (!buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': e.receiptMime ?? 'application/octet-stream', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
