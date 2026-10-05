import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { scheduledBoard } from '@/server/dispatch/preassign';

export const dynamic = 'force-dynamic';

// Upcoming scheduled rides this driver can pre-book (fit their vehicle) + their commitments.
// No passenger name/phone here — those appear only once the ride is assigned.
export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await scheduledBoard(ctx.driver.id));
}
