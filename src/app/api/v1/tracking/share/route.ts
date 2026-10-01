import { apiOk, apiError, Errors, clientIp, requestBaseUrl } from '@/lib/http';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getTrackingBookingId, createShareGrant } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

// Create a read-only "share my trip" link. Only the holder of the FULL private session can mint
// one; the link itself grants view-only access (see resolveShareToken / shareView).
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('share-create', clientIp(req, config.trustedProxyHops), 10, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!b || ['COMPLETED', 'CANCELED'].includes(b.status)) return apiError(409, 'TRIP_ENDED', 'This trip has ended.');
  const g = await createShareGrant(bookingId);
  return apiOk({ url: `${requestBaseUrl(req)}/share#t=${g.token}`, expiresAt: g.expiresAt.toISOString() });
}
