import { z } from 'zod';
import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { AIRPORT_CODES } from '@/lib/airports';
import { invalidateNoGoCache } from '@/server/no-go';
import { invalidateFixedFareCache } from '@/server/fixed-fares';

export const dynamic = 'force-dynamic';

// «Точка подачи для этих фикс цен» (operator 2026-11-25): on the fixed-prices page the admin picks, by name, the
// pickup territory that IS this airport — trips from / to it ↔ a zone get the zone price. One territory per airport.
const schema = z.object({ airport: z.enum(AIRPORT_CODES), territoryId: z.string().min(1).nullable() });

export async function PUT(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Errors.validation({ _: 'airport and territoryId (or null) are required.' });
  const { airport, territoryId } = parsed.data;
  if (territoryId) {
    const t = await prisma.noGoZone.findUnique({ where: { id: territoryId }, select: { kind: true } });
    if (!t || t.kind !== 'POINT') return Errors.validation({ territoryId: 'Not a pickup territory.' });
  }
  const name = await prisma.$transaction(async (tx) => {
    await tx.noGoZone.updateMany({ where: { airport, kind: 'POINT', ...(territoryId ? { id: { not: territoryId } } : {}) }, data: { airport: null } });
    if (!territoryId) return null;
    const row = await tx.noGoZone.update({ where: { id: territoryId }, data: { airport } });
    return row.name;
  });
  await prisma.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'AIRPORT_AREA_SET', target: territoryId ?? airport, detail: `${airport} → ${name ?? 'none'}` } });
  invalidateNoGoCache(); invalidateFixedFareCache();
  return apiOk({ airport, territoryId });
}
