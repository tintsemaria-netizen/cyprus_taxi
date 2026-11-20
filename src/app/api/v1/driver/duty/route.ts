import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { dutyToday } from '@/server/driver/duty';
import { mondayOf } from '@/server/driver/analytics';
import { nicosiaDayKey, nicosiaMidnightUtc, startOfNicosiaDay } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

// The driver's online time today (2026-11-20): for the «Время на линии» window on the map.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const now = new Date();
  return apiOk(await dutyToday(ctx.driver.id, startOfNicosiaDay(now), nicosiaMidnightUtc(mondayOf(nicosiaDayKey(now))), now));
}
