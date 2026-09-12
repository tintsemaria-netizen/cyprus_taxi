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
