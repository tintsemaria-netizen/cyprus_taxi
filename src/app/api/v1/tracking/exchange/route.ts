import { apiOk, Errors, clientIp } from '@/lib/http';
import { exchangeToken } from '@/lib/tracking';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Exchange a fragment token (never logged) for a booking-scoped HttpOnly cookie.
export async function POST(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('track-exchange', ip, 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const token = body.token;
  if (!token || typeof token !== 'string' || token.length < 20) {
    return Errors.validation({ token: 'Invalid tracking token.' });
  }
  const bookingId = await exchangeToken(token);
  if (!bookingId) return Errors.notFound('Tracking link is invalid or expired.');
  return apiOk({ ok: true });
}
