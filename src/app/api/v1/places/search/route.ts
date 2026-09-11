import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  // Demo fixtures are used ONLY in explicit demo mode. No real geocoder ADAPTER is
  // implemented yet, so in live mode we ALWAYS report unavailable — a provider name
  // or key in the environment is not an implemented adapter and must never cause the
  // static fixture list to run. (When a real adapter exists, dispatch to it here.)
  if (!config.demoMode) {
    return apiOk({ demo: false, unavailable: true, results: [] });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  if (q.trim().length < 2) return apiOk({ demo: config.demoMode, results: [] });
  const results = searchPlaces(q).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, kind: p.kind }));
  return apiOk({ demo: config.demoMode, results });
}
