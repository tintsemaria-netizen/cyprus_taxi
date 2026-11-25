import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { locationSampleSchema, zodFieldErrors } from '@/lib/validation';
import { ingestLocation } from '@/server/location';
import { updateStandQueue, standStateFor } from '@/server/stands';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = locationSampleSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  // Identity is bound to the authenticated driver — driverId is never trusted.
  const result = await ingestLocation(ctx.driver.id, parsed.data);
  if (!result.ok) return apiError(result.status, result.code, result.message);
  // «Стоянка с очередью» (2026-11-25): join / keep / lose the place; the driver's screen shows it.
  const p = { lat: parsed.data.lat, lng: parsed.data.lng };
  await updateStandQueue(ctx.driver.id, p);
  const stand = await standStateFor(ctx.driver.id, p).catch(() => null);
  return apiOk({ ok: true, stand });
}
