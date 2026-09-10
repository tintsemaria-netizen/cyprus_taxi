import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces, isDemoGeocoder } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  if (q.trim().length < 2) return apiOk({ demo: isDemoGeocoder(), results: [] });
  const results = searchPlaces(q).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, kind: p.kind }));
  return apiOk({ demo: isDemoGeocoder(), results });
}
