// Pure geometry for the driver navigation screen: where the car is along the route polyline,
// how far to the next manoeuvre and to the end, whether it has left the route. Paths are
// [lat, lng] pairs as returned by the navigation API. No DOM / React here (unit-tested).

export type LatLng = { lat: number; lng: number };
export interface NavStep { at: number; maneuver: string; text: string; distanceM: number }

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Point `m` metres from `p` along `headingDeg` (small distances; equirectangular).
export function offsetPoint(p: LatLng, headingDeg: number, m: number): LatLng {
  const h = rad(headingDeg);
  return { lat: p.lat + ((m * Math.cos(h)) / R) * (180 / Math.PI), lng: p.lng + ((m * Math.sin(h)) / (R * Math.cos(rad(p.lat)))) * (180 / Math.PI) };
}

// Cumulative distance (m) from the start of the path to each vertex.
export function cumulative(path: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + distM({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] }));
  return out;
}

export interface Progress {
  seg: number;        // index of the segment start vertex the car is on
  alongM: number;     // distance travelled along the path to the projected point
  offRouteM: number;  // perpendicular distance from the car to the path
  snapped: LatLng;    // car position projected onto the route
  bearing: number;    // direction of travel of that segment
}

// Project the car onto the path. Searches a window ahead of the previous segment first so a route
// that loops back past the same street doesn't make progress jump; falls back to the whole path.
export function locate(path: [number, number][], cum: number[], pos: LatLng, prevSeg = 0): Progress | null {
  if (path.length < 2) return null;
  const k = Math.cos(rad(pos.lat));
  const scan = (from: number, to: number) => {
    let best: { seg: number; t: number; d2: number } | null = null;
    for (let i = Math.max(0, from); i < Math.min(path.length - 1, to); i++) {
      const ax = path[i][1] * k, ay = path[i][0], bx = path[i + 1][1] * k, by = path[i + 1][0];
      const px = pos.lng * k, py = pos.lat;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d2 = qx * qx + qy * qy;
      if (!best || d2 < best.d2) best = { seg: i, t, d2 };
    }
    return best;
  };
  let best = scan(prevSeg - 2, prevSeg + 60);
  const near = best && toProgress(best).offRouteM < 40;
  if (!near) { const all = scan(0, path.length); if (all) best = all; }
  return best ? toProgress(best) : null;

  function toProgress(b: { seg: number; t: number }): Progress {
    const a = { lat: path[b.seg][0], lng: path[b.seg][1] }, c = { lat: path[b.seg + 1][0], lng: path[b.seg + 1][1] };
    const snapped = { lat: a.lat + (c.lat - a.lat) * b.t, lng: a.lng + (c.lng - a.lng) * b.t };
    return { seg: b.seg, alongM: cum[b.seg] + distM(a, snapped), offRouteM: distM(pos, snapped), snapped, bearing: bearingDeg(a, c) };
  }
}

// The upcoming manoeuvre: the first step whose anchor vertex is still ahead of the car.
// Step 0 is the departure ("Head south on …"): shown only before the car has moved, and its
// distance is how far to drive before the following manoeuvre.
export function nextStep(steps: NavStep[], cum: number[], alongM: number): { step: NavStep; index: number; inM: number } | null {
  const atM = (i: number) => cum[Math.min(steps[i].at, cum.length - 1)];
  for (let i = 0; i < steps.length; i++) {
    if (i === 0 && alongM < 5 && atM(0) <= alongM + 5) {
      const endM = steps.length > 1 ? atM(1) : cum[cum.length - 1];
      return { step: steps[0], index: 0, inM: Math.max(0, endM - alongM) };
    }
    if (atM(i) > alongM + 5) return { step: steps[i], index: i, inM: Math.max(0, atM(i) - alongM) };
  }
  return null;
}

// Round a distance the way a navigator speaks it: 10 m steps below 100, 50 m below 1 km, then km.
export function roundNavDistance(m: number): { value: number; unit: 'm' | 'km' } {
  if (m < 100) return { value: Math.max(10, Math.round(m / 10) * 10), unit: 'm' };
  if (m < 1000) return { value: Math.round(m / 50) * 50, unit: 'm' };
  return { value: Math.round(m / 100) / 10, unit: 'km' };
}

// Spoken prompt thresholds (m): announce once when the car first gets within each.
export const PROMPT_AT = [800, 250, 40] as const;
export function promptBand(inM: number): number | null {
  for (let i = PROMPT_AT.length - 1; i >= 0; i--) if (inM <= PROMPT_AT[i]) return PROMPT_AT[i];
  return null;
}

// Arrow glyph for Google Routes `maneuver` values.
export function maneuverIcon(m: string): string {
  switch (m) {
    case 'TURN_LEFT': case 'TURN_SHARP_LEFT': return '⬅';
    case 'TURN_RIGHT': case 'TURN_SHARP_RIGHT': return '➡';
    case 'TURN_SLIGHT_LEFT': case 'FORK_LEFT': case 'RAMP_LEFT': case 'MERGE': return '↖';
    case 'TURN_SLIGHT_RIGHT': case 'FORK_RIGHT': case 'RAMP_RIGHT': return '↗';
    case 'UTURN_LEFT': return '↶';
    case 'UTURN_RIGHT': return '↷';
    case 'ROUNDABOUT_LEFT': case 'ROUNDABOUT_RIGHT': return '⟲';
    case 'DEPART': case 'NAME_CHANGE': case 'STRAIGHT': return '⬆';
    case 'FERRY': case 'FERRY_TRAIN': return '⛴';
    default: return '⬆';
  }
}
