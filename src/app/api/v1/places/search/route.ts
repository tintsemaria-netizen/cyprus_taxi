import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured, googleSearch } from '@/server/google';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  if (q.trim().length < 2) return apiOk({ demo: config.demoMode, results: [] });

  // Real Google forward geocoding (Cyprus-biased) when configured.
  if (googleConfigured()) {
    try {
      const results = await googleSearch(q);
      return apiOk({ provider: 'google', demo: false, results });
    } catch {
      return apiOk({ provider: 'google', demo: false, unavailable: true, results: [] });
    }
  }

  // No real adapter → demo fixtures only in demo mode; otherwise unavailable.
  if (!config.demoMode) return apiOk({ demo: false, unavailable: true, results: [] });
  const results = searchPlaces(q).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, kind: p.kind }));
  return apiOk({ demo: true, results });
}
