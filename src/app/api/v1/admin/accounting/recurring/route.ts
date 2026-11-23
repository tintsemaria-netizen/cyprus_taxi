import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { requireOwner, recurringSchema, recurringView, materializeRecurring } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// A recurring income / expense (Apple once a year, server monthly …): booked automatically on its day.
export async function POST(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = recurringSchema.safeParse(raw);
  if (!p.success) return Errors.validation(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  const d = p.data;
  const r = await prisma.ledgerRecurring.create({ data: { kind: d.kind, amountCents: d.amountCents, category: d.category, counterparty: d.counterparty || null, method: d.method ?? null, note: d.note || null, every: d.every, nextDay: new Date(`${d.startDay}T00:00:00.000Z`), createdById: ctx.user.id } });
  await materializeRecurring();
  return apiOk({ recurring: recurringView(r) }, 201);
}
