import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AIRPORTS } from '@/lib/airports';
import { invalidateFixedFareCache, parsePolygon, zoneSchema } from '@/server/fixed-fares';

export const dynamic = 'force-dynamic';

// Fixed airport fare zones (2026-11-17) — admin only.

export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rows = await prisma.fixedFareZone.findMany({ orderBy: [{ airport: 'asc' }, { createdAt: 'asc' }] });
  return apiOk({ airports: AIRPORTS, zones: rows.map((r) => ({ ...r, polygon: parsePolygon(r.polygon) })) });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const parsed = zoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'Invalid zone: name, airport, at least 3 points and prices are required.' });
  const row = await prisma.fixedFareZone.create({ data: { ...parsed.data, active: parsed.data.active ?? true } });
  invalidateFixedFareCache();
  console.log(`[fixed-fares] zone created ${row.id} by staff ${ctx.user.id}`);
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) }, 201);
}
