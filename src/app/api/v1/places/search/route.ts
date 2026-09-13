import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured, googleSearch, googleAutocomplete, isPlacesDisabled } from '@/server/google';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  const session = (url.searchParams.get('session') || '').slice(0, 64) || undefined;
  if (q.trim().length < 2) return apiOk({ demo: config.demoMode, results: [] });

  if (googleConfigured()) {
    // Prefer Places (New) autocomplete (predictions → resolved via /places/details).
    // Falls back to forward geocoding if Places is not enabled on the project.
    if (session) {
      try {
        const preds = await googleAutocomplete(q, session);
        return apiOk({ provider: 'places', demo: false, results: preds.map((p) => ({ label: p.label, secondary: p.secondary, placeId: p.placeId })) });
      } catch (e) {
        if (!isPlacesDisabled(e)) {
          // Transient Places error: still try geocoding below before giving up.
        }
      }
    }
    // Forward geocoding (Cyprus-biased) — results carry real coordinates.
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
