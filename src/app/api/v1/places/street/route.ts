import { apiOk, Errors, clientIp } from '@/lib/http';
import { validCoord } from '@/lib/geo';
import { config } from '@/lib/config';
import { googleConfigured, googleStreetName } from '@/server/google';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// «Which street is the car on» for the map chip (2026-11-17). Cached on a ~30 m grid so several
// viewers of the same car and repeated fixes on one street cost one lookup.
const cache = new Map<string, { name: string | null; at: number }>();
const TTL_MS = 6 * 3600_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !validCoord({ lat, lng })) return Errors.validation({ _: 'Valid lat and lng are required.' });
  if (!googleConfigured()) return apiOk({ name: null });
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return apiOk({ name: hit.name });
  const rl = await rateLimit('street', clientIp(req, config.trustedProxyHops), 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  try {
    const name = await googleStreetName(lat, lng);
    if (cache.size > 5000) { const k = cache.keys().next().value; if (k) cache.delete(k); }
    cache.set(key, { name, at: Date.now() });
    return apiOk({ name });
  } catch {
    return apiOk({ name: null });
  }
}
