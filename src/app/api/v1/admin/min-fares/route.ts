import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parsePolygon } from '@/server/fixed-fares';
import { invalidateMinFareCache, minZoneData, minZoneSchema } from '@/server/min-fares';

export const dynamic = 'force-dynamic';

// Pre-booking minimum areas (2026-11-22) — admin only.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rows = await prisma.minFareZone.findMany({ orderBy: { createdAt: 'asc' } });
  return apiOk({ zones: rows.map((r) => ({ ...r, polygon: parsePolygon(r.polygon) })) });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const parsed = minZoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'Name, Comfort and XL prices and at least 3 corners are required.' });
  const row = await prisma.minFareZone.create({ data: minZoneData(parsed.data) });
  invalidateMinFareCache();
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'MIN_FARE_ZONE_CREATED', target: row.id, detail: `${row.name} C${row.comfortCents} XL${row.xlCents}` } });
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) }, 201);
}
