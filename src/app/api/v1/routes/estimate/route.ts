import { apiOk, Errors, clientIp } from '@/lib/http';
import { demoEstimate } from '@/lib/places';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';
import { googleConfigured, googleRoute } from '@/server/google';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const { from, to, departureTime } = (body as { from?: unknown; to?: unknown; departureTime?: string }) || {};
  if (!validCoord(from as never) || !validCoord(to as never)) {
    return Errors.validation({ _: 'from and to must be valid coordinates.' });
  }
  const f = from as { lat: number; lng: number };
  const t = to as { lat: number; lng: number };

  // Real Google driving route when configured.
  if (googleConfigured()) {
    const rl = await rateLimit('routes', clientIp(req, config.trustedProxyHops), 30, 60);
    if (!rl.ok) return Errors.throttled(rl.retryAfter);
    try {
      const r = await googleRoute(f, t, departureTime);
      if (!r) return apiOk({ provider: 'google', available: false, reason: 'No route found.' });
      return apiOk({ provider: 'google', available: true, estimate: false, ...r });
    } catch {
      return apiOk({ provider: 'google', available: false, reason: 'Routing temporarily unavailable.' });
    }
  }

  // No real router → demo estimate only in demo mode; otherwise unavailable.
  if (!config.demoMode) return apiOk({ available: false, reason: 'No routing provider configured.' });
  return apiOk({ available: true, ...demoEstimate(f, t) });
}
