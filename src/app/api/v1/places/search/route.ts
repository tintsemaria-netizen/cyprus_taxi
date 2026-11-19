import { apiOk, Errors, clientIp } from '@/lib/http';
import { searchPlaces } from '@/lib/places';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { googleConfigured, googleSearch, googleAutocomplete, isPlacesDisabled } from '@/server/google';
import { popularResults } from '@/server/popular';
import { photonSearch } from '@/server/photon';
import { searchOsm } from '@/server/osm/search';

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
  // Own Cyprus address base first (2026-11-19): every named place, street and house on the island,
  // on our server — instant and free. Outside services are asked only when it has nothing.
  const own = await searchOsm(q, near, 8).catch((e) => { console.error('[places] own base', e); return null; });
  if (own && own.length) return apiOk({ provider: 'osm', demo: false, attribution: '© OpenStreetMap', results: withPopular(popular, own).slice(0, 10) });
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
    // Without Google autocomplete (2026-11-18): streets / houses / hotels by the first letters from
    // OpenStreetMap (Photon), plus Google forward geocoding for full addresses; both in parallel.
    const [osm, geo] = await Promise.all([
      photonSearch(q, near).catch(() => [] as Awaited<ReturnType<typeof photonSearch>>),
      googleSearch(q).catch(() => null),
    ]);
    // A whole-country / town-centre geocode answer is no help while typing — keep only real addresses.
    const geoUseful = (geo ?? []).filter((g) => /\d/.test(g.label) || g.label.split(',').length >= 3);
    const merged = withPopular(popular, [...osm, ...geoUseful.filter((g) => !osm.some((o) => Math.abs(o.lat - g.lat) < 0.0005 && Math.abs(o.lng - g.lng) < 0.0005))]);
    if (merged.length) return apiOk({ provider: 'google', demo: false, results: merged.slice(0, 10) });
    return apiOk({ provider: 'google', demo: false, unavailable: geo === null && !osm.length, results: [] });
  }

  // No real adapter → demo fixtures only in demo mode; otherwise unavailable.
  if (!config.demoMode) return popular.length ? apiOk({ demo: false, results: popular }) : apiOk({ demo: false, unavailable: true, results: [] });
  const results = searchPlaces(q).map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, kind: p.kind }));
  return apiOk({ demo: true, results: withPopular(popular, results) });
}
