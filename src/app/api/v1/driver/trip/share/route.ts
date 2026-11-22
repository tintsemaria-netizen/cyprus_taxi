import { apiOk, apiError, Errors, clientIp, requestBaseUrl } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { createShareGrant } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

// «Поделиться поездкой» for the DRIVER (operator, 2026-11-23): if something feels wrong, the driver
// sends a read-only link to someone he trusts. Same view-only link as the passenger's (car,
// position, route; no phone numbers), only for the driver's own ACTIVE trip, ends with the trip.
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rl = await rateLimit('driver-share', `${ctx.driver.id}|${clientIp(req, config.trustedProxyHops)}`, 10, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const a = await prisma.assignment.findFirst({ where: { activeDriverId: ctx.driver.id }, select: { bookingId: true, booking: { select: { status: true } } } });
  if (!a || ['COMPLETED', 'CANCELED'].includes(a.booking.status)) return apiError(409, 'TRIP_ENDED', 'This trip has ended.');
  const g = await createShareGrant(a.bookingId);
  return apiOk({ url: `${requestBaseUrl(req)}/share#t=${g.token}`, expiresAt: g.expiresAt.toISOString() });
}
