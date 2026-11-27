import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { z } from 'zod';
import { driverProfile, updateDriverProfile } from '@/server/driver/profile';

export const dynamic = 'force-dynamic';

// «Мои данные», emergency contact, payout details (2026-11-27, operator).
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const p = await driverProfile(ctx.driver.id);
  if (!p) return Errors.notFound();
  return apiOk(p);
}

const schema = z.object({
  emergencyName: z.string().max(200).nullable().optional(),
  emergencyPhone: z.string().max(60).nullable().optional(),
  iban: z.string().max(80).nullable().optional(),
  ibanHolder: z.string().max(200).nullable().optional(),
});
export async function PATCH(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Errors.validation({ _: 'Invalid body.' });
  const errs = await updateDriverProfile(ctx.driver.id, p.data);
  if (errs) return Errors.validation(errs);
  return apiOk(await driverProfile(ctx.driver.id));
}
