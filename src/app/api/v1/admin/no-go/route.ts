import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parsePolygon } from '@/server/fixed-fares';
import { invalidateNoGoCache, noGoSchema } from '@/server/no-go';

export const dynamic = 'force-dynamic';

// «Запретная зона» (2026-11-24) — admin only.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rows = await prisma.noGoZone.findMany({ orderBy: { createdAt: 'asc' } });
  return apiOk({ zones: rows.map((r) => ({ ...r, polygon: parsePolygon(r.polygon) })) });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const parsed = noGoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'A name and at least 3 corners are required.' });
  const row = await prisma.noGoZone.create({ data: { name: parsed.data.name, polygon: parsed.data.polygon, active: parsed.data.active ?? true } });
  invalidateNoGoCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'NO_GO_ZONE_CREATED', target: row.id, detail: row.name } });
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) }, 201);
}
