import { config, CYPRUS_BOUNDS } from '@/lib/config';

// Server-side Google Maps Platform adapters (Geocoding + Routes). The server key is
// never exposed to the browser. All calls are bounded by a timeout; callers add
// rate limiting. Cyprus-biased. Returns null/errors are distinguished by the caller.

const TIMEOUT_MS = 8000;

export function googleConfigured(): boolean {
  return !!config.googleServerKey();
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Reverse geocode a pin. Returns a human label or null (no match / not a building).
// The caller keeps the exact pin coordinate; this only supplies an optional label.
export async function googleReverse(lat: number, lng: number): Promise<{ label: string } | null> {
  const key = config.googleServerKey();
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
  const d = (await fetchJson(url)) as { status?: string; results?: { formatted_address?: string; types?: string[] }[] };
  if (d.status === 'OK' && d.results && d.results.length) {
    // Prefer a street/premise result over a bare plus-code where available.
    const best = d.results.find((r) => !(r.types || []).includes('plus_code')) ?? d.results[0];
    if (best.formatted_address) return { label: best.formatted_address };
  }
  if (d.status && d.status !== 'ZERO_RESULTS' && d.status !== 'OK') throw new Error(`geocode:${d.status}`);
  return null;
}

// Forward geocode / address search, restricted to Cyprus. Returns resolved places
// with real coordinates (not predictions). Deduplicated, bounded count.
export async function googleSearch(q: string, limit = 6): Promise<{ label: string; lat: number; lng: number }[]> {
  const key = config.googleServerKey();
  const b = CYPRUS_BOUNDS;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}` +
    `&components=country:CY&bounds=${b.south},${b.west}|${b.north},${b.east}&region=cy&key=${key}`;
  const d = (await fetchJson(url)) as {
    status?: string;
    results?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }[];
  };
  if (d.status && d.status !== 'OK' && d.status !== 'ZERO_RESULTS') throw new Error(`geocode:${d.status}`);
  const out: { label: string; lat: number; lng: number }[] = [];
  for (const r of d.results ?? []) {
    const loc = r.geometry?.location;
    if (r.formatted_address && loc) out.push({ label: r.formatted_address, lat: loc.lat, lng: loc.lng });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- Places API (New): autocomplete predictions + selected-place details ----
// A billing session ties N autocomplete calls + 1 details call together. On a not-enabled
// / permission-denied response we throw 'places-disabled' so the caller falls back to
// forward geocoding (Places API (New) may not be enabled on the project — see HANDOFF).
export interface PlacePrediction { placeId: string; label: string; secondary?: string }

const PLACES_DISABLED = 'places-disabled';
export function isPlacesDisabled(e: unknown): boolean {
  return e instanceof Error && e.message === PLACES_DISABLED;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function googleAutocomplete(input: string, sessionToken: string, limit = 6): Promise<PlacePrediction[]> {
  const key = config.googleServerKey();
  const b = CYPRUS_BOUNDS;
  const body = {
    input,
    sessionToken,
    includedRegionCodes: ['cy'],
    locationBias: { rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } } },
  };
  const res = await fetchWithTimeout('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new Error(PLACES_DISABLED);
  const d = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[];
    error?: { status?: string };
  };
  if (d.error) throw new Error(d.error.status === 'PERMISSION_DENIED' ? PLACES_DISABLED : `places:${d.error.status}`);
  const out: PlacePrediction[] = [];
  for (const s of d.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p) continue;
    out.push({ placeId: p.placeId, label: p.structuredFormat?.mainText?.text || p.text?.text || 'Unknown', secondary: p.structuredFormat?.secondaryText?.text });
    if (out.length >= limit) break;
  }
  return out;
}

export async function googlePlaceDetails(placeId: string, sessionToken: string): Promise<{ label: string; lat: number; lng: number } | null> {
  const key = config.googleServerKey();
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetchWithTimeout(url, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location,formattedAddress,displayName' } });
  if (res.status === 401 || res.status === 403) throw new Error(PLACES_DISABLED);
  const d = (await res.json()) as { location?: { latitude: number; longitude: number }; formattedAddress?: string; displayName?: { text?: string }; error?: { status?: string } };
  if (d.error) throw new Error(d.error.status === 'PERMISSION_DENIED' ? PLACES_DISABLED : `places:${d.error.status}`);
  if (!d.location) return null;
  return { label: d.formattedAddress || d.displayName?.text || 'Selected location', lat: d.location.latitude, lng: d.location.longitude };
}

export interface RouteResult {
  distanceKm: number;
  etaMinutes: number;
  path: [number, number][]; // [lat, lng] decoded polyline
}

// Compute a real driving route (distance, duration, geometry) via the Routes API.
export async function googleRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  departureTime?: string,
): Promise<RouteResult | null> {
  const key = config.googleServerKey();
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: 'DRIVE',
  };
  if (departureTime) {
    body.routingPreference = 'TRAFFIC_AWARE';
    body.departureTime = departureTime;
  }
  const d = (await fetchJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
  })) as {
    routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[];
    error?: { message?: string };
  };
  if (d.error) throw new Error(`routes:${d.error.message ?? 'error'}`);
  const r = d.routes?.[0];
  if (!r || r.distanceMeters == null) return null;
  const durationSec = Number((r.duration ?? '0s').replace('s', ''));
  return {
    distanceKm: Math.round((r.distanceMeters / 1000) * 10) / 10,
    etaMinutes: Math.round(durationSec / 60),
    path: r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [],
  };
}

// Standard Google encoded-polyline decoder → [lat, lng] pairs.
function decodePolyline(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const coords: [number, number][] = [];
  while (index < str.length) {
    let result = 1, shift = 0, b: number;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1; shift = 0;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat * 1e-5, lng * 1e-5]);
  }
  return coords;
}
