import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { scheduledBoard } from '@/server/dispatch/preassign';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Upcoming scheduled rides this driver can pre-book (fit their vehicle) + their commitments.
// No passenger name/phone here — those appear only once the ride is assigned.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  // The pre-booking rules for the «ⓘ» info (2026-11-26): the real server settings, not numbers copied into the app.
  const p = config.dispatch.preassign;
  const rules = { protectMin: p.protectMinutes, convertMin: p.convertMinutes, leadMin: config.dispatch.scheduleLeadMinutes, lateReleaseMin: p.lateReleaseMinutes };
  return apiOk({ ...(await scheduledBoard(ctx.driver.id)), rules });
}
