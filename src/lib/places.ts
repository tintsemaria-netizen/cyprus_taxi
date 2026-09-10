import { config } from './config';
import { LatLng } from './geo';

// DEMO geocoder: a fixed set of real Cyprus places used when no external
// geocoder is configured. Results are clearly demo fixtures (SPEC §9).
export interface Place {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

const CYPRUS_PLACES: Place[] = [
  { label: 'Limassol Marina', lat: 34.6706, lng: 33.0413, kind: 'landmark' },
  { label: 'Limassol Castle', lat: 34.6722, lng: 33.0426, kind: 'landmark' },
  { label: 'Larnaca Airport (LCA)', lat: 34.8751, lng: 33.6249, kind: 'airport' },
  { label: 'Paphos Airport (PFO)', lat: 34.7180, lng: 32.4857, kind: 'airport' },
  { label: 'Nicosia city centre', lat: 35.1748, lng: 33.3644, kind: 'city' },
  { label: 'Ayia Napa harbour', lat: 34.9884, lng: 34.0006, kind: 'landmark' },
  { label: 'Paphos harbour', lat: 34.7536, lng: 32.4076, kind: 'landmark' },
  { label: 'Protaras beach', lat: 35.0125, lng: 34.0583, kind: 'landmark' },
  { label: 'Troodos square', lat: 34.9223, lng: 32.8792, kind: 'landmark' },
  { label: 'Limassol Old Port', lat: 34.6512, lng: 33.0447, kind: 'landmark' },
  { label: 'Larnaca Finikoudes', lat: 34.9128, lng: 33.6377, kind: 'landmark' },
  { label: 'Kourion archaeological site', lat: 34.6644, lng: 32.8880, kind: 'landmark' },
];

export function searchPlaces(q: string, limit = 6): Place[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const scored = CYPRUS_PLACES.map((p) => {
    const label = p.label.toLowerCase();
    let score = 0;
    if (label.startsWith(query)) score = 3;
    else if (label.includes(query)) score = 2;
    else if (query.split(' ').some((w) => w && label.includes(w))) score = 1;
    return { p, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p);
  return scored;
}

export function isDemoGeocoder(): boolean {
  return config.demoMode || !process.env.GEOCODER_PROVIDER;
}

// DEMO router: straight-line distance + a nominal average speed. The result is
// explicitly labelled an estimate and never presented as a real road route.
export function demoEstimate(a: LatLng, b: LatLng): { distanceKm: number; etaMinutes: number; estimate: true; demo: true } {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const straightKm = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  const roadKm = straightKm * 1.3; // rough road factor
  const etaMinutes = Math.round((roadKm / 65) * 60); // ~65 km/h average
  return { distanceKm: Math.round(roadKm * 10) / 10, etaMinutes, estimate: true, demo: true };
}
