// Geometry helpers. Coordinates are always {lat, lng}; we keep lng/lat ordering
// explicit only at the map adapter boundary.

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000; // earth radius, metres

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Ray-casting point-in-polygon. Polygon is an array of {lat,lng} rings.
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng,
      yi = polygon[i].lat;
    const xj = polygon[j].lng,
      yj = polygon[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function validCoord(p: Partial<LatLng>): p is LatLng {
  return (
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

// Default synthetic Cyprus service area (DEMO only, SPEC §1). Rough bounding
// polygon over the island — configurable via Settings for real operation.
export const DEMO_CYPRUS_POLYGON: LatLng[] = [
  { lat: 35.72, lng: 32.25 },
  { lat: 35.72, lng: 34.65 },
  { lat: 34.55, lng: 34.65 },
  { lat: 34.55, lng: 32.25 },
];
