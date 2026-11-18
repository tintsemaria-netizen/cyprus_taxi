// Streets, houses and hotels by the first letters (2026-11-18), from OpenStreetMap via Photon
// (komoot's public search-as-you-type service). Used when Google's autocomplete is not available,
// so «agias so…» or «hotel amara» finds the right place after a few letters. Results carry real
// coordinates (no extra details call). Cyprus only; places near the passenger first.

export interface PhotonResult { label: string; secondary?: string; lat: number; lng: number; kind?: string }

const BBOX = '32.2,34.55,34.65,35.72'; // minLon,minLat,maxLon,maxLat — the island
const cache = new Map<string, { at: number; rows: PhotonResult[] }>();
const TTL_MS = 10 * 60_000;

interface Feature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; street?: string; housenumber?: string; city?: string; district?: string; locality?: string; county?: string; countrycode?: string; osm_key?: string; osm_value?: string; type?: string };
}

export function parsePhoton(json: unknown, limit = 6): PhotonResult[] {
  const out: PhotonResult[] = [];
  const seen = new Set<string>();
  for (const f of ((json as { features?: Feature[] })?.features ?? [])) {
    const p = f.properties ?? {}; const c = f.geometry?.coordinates;
    if (!c || (p.countrycode && p.countrycode.toUpperCase() !== 'CY')) continue;
    const town = p.city || p.locality || p.district || p.county;
    const streetLine = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
    let label = '', secondary: string | undefined;
    if (p.name) { label = p.name; secondary = [p.type === 'street' ? '' : streetLine, town].filter(Boolean).join(', ') || undefined; }
    else if (streetLine) { label = streetLine; secondary = town; }
    else continue;
    const key = `${label}|${secondary ?? ''}`.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const kind = p.osm_value === 'hotel' || p.osm_value === 'guest_house' || p.osm_value === 'apartment' ? 'hotel' : p.osm_key === 'highway' ? 'street' : undefined;
    out.push({ label, secondary, lat: c[1], lng: c[0], ...(kind ? { kind } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function photonSearch(q: string, near: { lat: number; lng: number } | null, limit = 6): Promise<PhotonResult[]> {
  const key = `${q.trim().toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const params = new URLSearchParams({ q, limit: String(limit + 4), lang: 'en', bbox: BBOX });
  if (near) { params.set('lat', String(near.lat)); params.set('lon', String(near.lng)); params.set('location_bias_scale', '0.3'); }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: ctl.signal, headers: { 'User-Agent': 'IL-Y taxi (il-y.taxi)' } });
    if (!res.ok) throw new Error(`photon:${res.status}`);
    const rows = parsePhoton(await res.json(), limit);
    if (cache.size > 2000) { const k = cache.keys().next().value; if (k) cache.delete(k); }
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } finally { clearTimeout(t); }
}
