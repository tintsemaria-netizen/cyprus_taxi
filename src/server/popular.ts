import { googleFindPoi } from '@/server/google';
import { matchPopular, nearestPopular, type PopularPlace } from '@/lib/popularPlaces';

// Popular places first (2026-11-18): matched locally, nearest first; coordinates cached.
const poiCache = new Map<string, { at: { lat: number; lng: number } | null; t: number }>();
async function resolve(list: PopularPlace[], google: boolean) {
  // In parallel; each place is looked up once (cached), then kept in the given order.
  const found = await Promise.all(list.map(async (p) => {
    let at = p.at ?? null;
    if (!at && p.query && google) {
      const c = poiCache.get(p.query);
      if (c && (c.at || Date.now() - c.t < 86_400_000)) at = c.at;
      else { try { at = await googleFindPoi(p.query); } catch { at = null; } poiCache.set(p.query, { at, t: Date.now() }); }
    }
    return at ? { label: p.name, secondary: p.city, lat: at.lat, lng: at.lng, kind: 'popular' } : null;
  }));
  return found.filter((x): x is NonNullable<typeof x> => !!x);
}

export function popularResults(q: string, near: { lat: number; lng: number } | null, google: boolean) {
  return resolve(matchPopular(q, near), google);
}
/** Nearest popular places for the empty search box. */
export function popularNear(near: { lat: number; lng: number }, google: boolean, max = 6) {
  return resolve(nearestPopular(near, max + 3), google).then((r) => r.slice(0, max));
}
