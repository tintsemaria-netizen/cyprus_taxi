import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AIRPORTS } from '@/lib/airports';
import { pickupPoints } from '@/server/no-go';
import { invalidateFixedFareCache, parsePolygon, zoneData, zoneSchema } from '@/server/fixed-fares';

export const dynamic = 'force-dynamic';

// Fixed airport fare zones (2026-11-17) — admin only.

export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rows = await prisma.fixedFareZone.findMany({ orderBy: [{ airport: 'asc' }, { createdAt: 'asc' }] });
  // Where each airport is (2026-11-25): the pickup territory chosen for its fixed fares — shown instead of the old circle.
  const terr = await pickupPoints();
  // …or a no-go zone (2026-11-26): the trip starts / ends at its points next to it.
  const nogo = (await prisma.noGoZone.findMany({ where: { kind: 'NOGO', active: true }, orderBy: { createdAt: 'asc' } }))
    .map((r) => ({ id: r.id, name: r.name, airport: r.airport ?? null, polygon: parsePolygon(r.polygon) as [number, number][] }));
  const all = [...terr.map((t) => ({ ...t, nogo: false })), ...nogo.map((t) => ({ ...t, nogo: true }))];
  const airports = AIRPORTS.map((a) => ({ ...a, areas: all.filter((t) => t.airport === a.code).map((t) => ({ name: t.name, polygon: t.polygon })) }));
  const territories = all.map((t) => ({ id: t.id, name: t.name, airport: t.airport, nogo: t.nogo }));
  return apiOk({ airports, territories, zones: rows.map((r) => ({ ...r, polygon: parsePolygon(r.polygon) })) });
}

export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const parsed = zoneSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'Invalid zone: name, airport, prices and at least 3 corners (or a ring radius) are required.' });
  const row = await prisma.fixedFareZone.create({ data: zoneData(parsed.data) });
  invalidateFixedFareCache();
  console.log(`[fixed-fares] zone created ${row.id} by staff ${ctx.user.id}`);
  return apiOk({ ...row, polygon: parsePolygon(row.polygon) }, 201);
}
