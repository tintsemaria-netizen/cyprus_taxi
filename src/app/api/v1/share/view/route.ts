import { apiOk, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { resolveShareToken } from '@/lib/tracking';
import { shareView } from '@/server/views';

export const dynamic = 'force-dynamic';

// Read-only shared trip. The token travels in the POST body (never the URL/logs); the page reads it
// from the link fragment.
export async function POST(req: Request) {
  const rl = await rateLimit('share-view', clientIp(req, config.trustedProxyHops), 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { token?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const token = typeof body.token === 'string' ? body.token : '';
  if (token.length < 20) return Errors.notFound('This shared trip link is invalid or has expired.');
  const bookingId = await resolveShareToken(token);
  if (!bookingId) return Errors.notFound('This shared trip link is invalid or has expired.');
  const v = await shareView(bookingId);
  if (!v) return Errors.notFound('This shared trip link is invalid or has expired.');
  return apiOk(v);
}
