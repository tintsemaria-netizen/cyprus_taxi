import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { listMessages, postMessage } from '@/server/chat';
import { notifyNewMessage } from '@/server/push';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Passenger chat, authorized by the tracking token (same scope as /tracking/booking).
export async function GET(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const since = new URL(req.url).searchParams.get('after') || undefined;
  return apiOk(await listMessages(bookingId, since));
}

export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('chat-send', clientIp(req, config.trustedProxyHops), 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { body?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const r = await postMessage(bookingId, 'PASSENGER', body.body ?? '');
  if (!r.ok) return apiError(r.status, r.code, r.message);
  void notifyNewMessage(bookingId, 'PASSENGER', r.message.body).catch(() => {}); // best-effort
  return apiOk({ ok: true, message: r.message }, 201);
}
