import { apiOk, Errors, clientIp } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured, googlePlaceDetails } from '@/server/google';

export const dynamic = 'force-dynamic';

// Resolve a Places (New) prediction (from /places/search?provider=places) to coordinates.
// Same billing session token as the autocomplete calls. Unavailable if Places is off.
export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const url = new URL(req.url);
  const placeId = (url.searchParams.get('placeId') || '').slice(0, 300);
  const session = (url.searchParams.get('session') || '').slice(0, 64);
  if (!placeId || !session) return Errors.validation({ _: 'placeId and session are required.' });
  if (!googleConfigured()) return apiOk({ place: null, unavailable: true });

  try {
    const place = await googlePlaceDetails(placeId, session);
    return apiOk({ place });
  } catch {
    return apiOk({ place: null, unavailable: true });
  }
}
