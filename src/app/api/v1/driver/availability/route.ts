import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { prisma } from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ onDuty: z.boolean().optional(), available: z.boolean().optional() });

export async function PATCH(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Errors.validation({ _: 'onDuty/available must be booleans.' });

  // Going off duty / unavailable must not cancel an active trip (SPEC §4).
  const active = await prisma.assignment.findFirst({ where: { activeDriverId: ctx.driver.id } });
  const data: { onDuty?: boolean; available?: boolean } = {};
  if (typeof parsed.data.onDuty === 'boolean') {
    data.onDuty = parsed.data.onDuty;
    if (!parsed.data.onDuty) data.available = false;
  }
  if (typeof parsed.data.available === 'boolean' && !active) {
    data.available = parsed.data.available;
  }
  // If there's an active trip, availability stays false regardless.
  if (active) data.available = false;

  const updated = await prisma.driver.update({ where: { id: ctx.driver.id }, data });
  return apiOk({ onDuty: updated.onDuty, available: updated.available, hasActiveTrip: !!active });
}
