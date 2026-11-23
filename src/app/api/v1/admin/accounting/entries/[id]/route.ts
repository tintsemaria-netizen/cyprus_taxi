import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner, entrySchema, entryView } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// Change or remove one entry (owner only). Removing keeps the row (deletedAt) for the history.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = entrySchema.safeParse(raw);
  if (!p.success) return Errors.validation(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  const d = p.data;
  const cur = await prisma.ledgerEntry.findFirst({ where: { id, deletedAt: null } });
  if (!cur) return Errors.notFound();
  const e = await prisma.ledgerEntry.update({ where: { id }, data: { kind: d.kind, day: new Date(`${d.day}T00:00:00.000Z`), amountCents: d.amountCents, category: d.category, counterparty: d.counterparty || null, method: d.method ?? null, note: d.note || null } });
  return apiOk({ entry: entryView(e) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await prisma.ledgerEntry.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count !== 1) return Errors.notFound();
  return apiOk({ ok: true });
}
