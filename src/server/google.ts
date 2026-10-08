import { config, CYPRUS_BOUNDS } from '@/lib/config';

// Server-side Google Maps Platform adapters (Geocoding + Routes). The server key is
// never exposed to the browser. All calls are bounded by a timeout; callers add
// rate limiting. Cyprus-biased. Returns null/errors are distinguished by the caller.

const TIMEOUT_MS = 8000;

export function googleConfigured(): boolean {
  return !!config.googleServerKey();
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs: number = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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

// Keeps the abort timer running until the body is parsed too (a slow/hung response body
// must also time out, not just the initial fetch).
async function fetchJsonWithStatus(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
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
  const { status, json } = await fetchJsonWithStatus('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify(body),
  });
  if (status === 401 || status === 403) throw new Error(PLACES_DISABLED);
  const d = json as {
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
  const { status, json } = await fetchJsonWithStatus(url, { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location,formattedAddress,displayName' } });
  if (status === 401 || status === 403) throw new Error(PLACES_DISABLED);
  const d = json as { location?: { latitude: number; longitude: number }; formattedAddress?: string; displayName?: { text?: string }; error?: { status?: string } };
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
  opts: { timeoutMs?: number } = {},
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
  }, opts.timeoutMs)) as {
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

// Turn-by-turn driving route for the driver navigation screen: the same Routes API call plus
// per-step manoeuvres/instructions in the driver's language. Each step carries `at`, the index in
// `path` where the manoeuvre happens, so the client can track progress along one polyline.
export interface NavStep { at: number; maneuver: string; text: string; distanceM: number }
export interface NavRouteResult { distanceM: number; durationSec: number; path: [number, number][]; steps: NavStep[] }

export async function googleNavRoute(
  from: { lat: number; lng: number; heading?: number | null },
  to: { lat: number; lng: number },
  languageCode: string,
  opts: { timeoutMs?: number } = {},
): Promise<NavRouteResult | null> {
  const key = config.googleServerKey();
  const origin: Record<string, unknown> = { latLng: { latitude: from.lat, longitude: from.lng } };
  // A heading lets Google start the route in the direction the car is already moving.
  if (from.heading != null && Number.isFinite(from.heading)) origin.heading = Math.round(((from.heading % 360) + 360) % 360);
  const d = (await fetchJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction',
    },
    body: JSON.stringify({
      origin: { location: origin },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode,
      units: 'METRIC',
    }),
  }, opts.timeoutMs)) as {
    routes?: {
      distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string };
      legs?: { steps?: { distanceMeters?: number; startLocation?: { latLng?: { latitude: number; longitude: number } }; navigationInstruction?: { maneuver?: string; instructions?: string } }[] }[];
    }[];
    error?: { message?: string };
  };
  if (d.error) throw new Error(`routes:${d.error.message ?? 'error'}`);
  const r = d.routes?.[0];
  if (!r || r.distanceMeters == null || !r.polyline?.encodedPolyline) return null;
  const path = decodePolyline(r.polyline.encodedPolyline);
  const raw = (r.legs ?? []).flatMap((l) => l.steps ?? []);
  return { distanceM: r.distanceMeters, durationSec: Number((r.duration ?? '0s').replace('s', '')), path, steps: anchorSteps(path, raw) };
}

// Map each step's start point to the nearest path vertex, searching forward only (steps are in
// route order, and a route can pass the same spot twice).
export function anchorSteps(
  path: [number, number][],
  raw: { distanceMeters?: number; startLocation?: { latLng?: { latitude: number; longitude: number } }; navigationInstruction?: { maneuver?: string; instructions?: string } }[],
): NavStep[] {
  const out: NavStep[] = [];
  let from = 0;
  for (const s of raw) {
    const ll = s.startLocation?.latLng;
    if (!ll) continue;
    let best = from, bestD = Infinity;
    for (let i = from; i < path.length; i++) {
      const dLat = path[i][0] - ll.latitude, dLng = (path[i][1] - ll.longitude) * Math.cos((ll.latitude * Math.PI) / 180);
      const dd = dLat * dLat + dLng * dLng;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    from = best;
    out.push({ at: best, maneuver: s.navigationInstruction?.maneuver ?? 'STRAIGHT', text: s.navigationInstruction?.instructions ?? '', distanceM: s.distanceMeters ?? 0 });
  }
  return out;
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
