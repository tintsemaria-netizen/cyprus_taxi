import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// «Беру попутчиков» switch (Task 022): without it the driver never gets co-rider proposals or
// pre-booked shared pairs.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const d = await prisma.driver.findUnique({ where: { id: ctx.driver.id }, select: { acceptsShared: true } });
  // noShowMin (2026-11-27): when «Не вышел» becomes available — 3 free + 2 paid minutes, as for every ride.
  return apiOk({ acceptsShared: !!d?.acceptsShared, discountPct: config.share.discountPct, noShowMin: Math.round(config.dispatch.waitingGraceSeconds / 60) + config.dispatch.lateCancelAfterPaidMin });
}

const schema = z.object({ acceptsShared: z.boolean() });
export async function PATCH(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = schema.safeParse(raw);
  if (!p.success) return Errors.validation({ acceptsShared: 'Must be a boolean.' });
  await prisma.driver.update({ where: { id: ctx.driver.id }, data: { acceptsShared: p.data.acceptsShared } });
  return apiOk({ acceptsShared: p.data.acceptsShared });
}
