import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner, accountingView, entrySchema, entryView, type PeriodKind } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// Owner's bookkeeping (2026-11-23). GET ?period=month|quarter|year&key=2026-11 — figures + entries.
export async function GET(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const u = new URL(req.url);
  const k = u.searchParams.get('period');
  const kind: PeriodKind = k === 'quarter' || k === 'year' ? k : 'month';
  return apiOk(await accountingView(kind, u.searchParams.get('key')));
}

// POST — a new income / expense entered by hand.
export async function POST(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = entrySchema.safeParse(raw);
  if (!p.success) return Errors.validation(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  const d = p.data;
  const e = await prisma.ledgerEntry.create({ data: { kind: d.kind, day: new Date(`${d.day}T00:00:00.000Z`), amountCents: d.amountCents, category: d.category, counterparty: d.counterparty || null, method: d.method ?? null, note: d.note || null, createdById: ctx.user.id } });
  return apiOk({ entry: entryView(e) }, 201);
}
