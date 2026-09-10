import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { locationSampleSchema, zodFieldErrors } from '@/lib/validation';
import { ingestLocation } from '@/server/location';

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
  return apiOk({ ok: true });
}
