import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { publicFleet } from '@/server/views';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Other on-duty cars for the driver's home map: the same anonymised view passengers get
// (position + available/busy, no ids, names or plates), without the requesting driver's own car.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('driver-fleet', ctx.driver.id, 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  return apiOk({ vehicles: await publicFleet({ excludeDriverId: ctx.driver.id }) });
}
