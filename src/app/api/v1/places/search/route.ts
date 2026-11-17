import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured, googleSearch, googleAutocomplete, googleFindPoi, isPlacesDisabled } from '@/server/google';
import { matchPopular, type PopularPlace } from '@/lib/popularPlaces';

// Popular places first (2026-11-18): matched locally, nearest first; coordinates cached.
const poiCache = new Map<string, { at: { lat: number; lng: number } | null; t: number }>();
async function popularResults(q: string, near: { lat: number; lng: number } | null, google: boolean) {
  const out: { label: string; secondary: string; lat: number; lng: number; kind: string }[] = [];
  for (const p of matchPopular(q, near) as PopularPlace[]) {
    let at = p.at ?? null;
    if (!at && p.query && google) {
      const c = poiCache.get(p.query);
      if (c && (c.at || Date.now() - c.t < 86_400_000)) at = c.at;
      else { try { at = await googleFindPoi(p.query); } catch { at = null; } poiCache.set(p.query, { at, t: Date.now() }); }
    }
    if (at) out.push({ label: p.name, secondary: p.city, lat: at.lat, lng: at.lng, kind: 'popular' });
  }
  return out;
}
function withPopular<T extends { label: string }>(pop: { label: string }[], rest: T[]): (T | (typeof pop)[number])[] {
  const seen = new Set(pop.map((p) => p.label.toLowerCase()));
  return [...pop, ...rest.filter((r) => !seen.has(r.label.toLowerCase()))];
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('places', ip, 60, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  const session = (url.searchParams.get('session') || '').slice(0, 64) || undefined;
  // Passenger position for «near me first» ranking (optional, Cyprus only).
  const nm = (url.searchParams.get('near') || '').match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  const near = nm && Number(nm[1]) > 34 && Number(nm[1]) < 36 && Number(nm[2]) > 32 && Number(nm[2]) < 35 ? { lat: Number(nm[1]), lng: Number(nm[2]) } : null;
  if (q.trim().length < 2) return apiOk({ demo: config.demoMode, results: [] });

  const popular = await popularResults(q, near, googleConfigured());
  if (googleConfigured()) {
    // Prefer Places (New) autocomplete (predictions → resolved via /places/details).
    // Falls back to forward geocoding if Places is not enabled on the project.
    if (session) {
      try {
        const preds = await googleAutocomplete(q, session, 6, near);
        return apiOk({ provider: 'places', demo: false, results: withPopular(popular, preds.map((p) => ({ label: p.label, secondary: p.secondary, placeId: p.placeId }))) });
      } catch (e) {
        if (!isPlacesDisabled(e)) {
          // Transient Places error: still try geocoding below before giving up.
        }
      }
    }
    // Forward geocoding (Cyprus-biased) — results carry real coordinates.
    try {
      const results = await googleSearch(q);
      return apiOk({ provider: 'google', demo: false, results: withPopular(popular, results) });
    } catch {
      return popular.length ? apiOk({ provider: 'google', demo: false, results: popular }) : apiOk({ provider: 'google', demo: false, unavailable: true, results: [] });
    }
  }

  // No real adapter → demo fixtures only in demo mode; otherwise unavailable.
  if (!config.demoMode) return popular.length ? apiOk({ demo: false, results: popular }) : apiOk({ demo: false, unavailable: true, results: [] });
  const results = searchPlaces(q).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, kind: p.kind }));
  return apiOk({ demo: true, results: withPopular(popular, results) });
}
