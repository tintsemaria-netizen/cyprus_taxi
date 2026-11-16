// Speed-dependent navigation zoom (2026-11-17): the faster the car, the further the driver sees.
// City speeds stay close to street level; motorway speeds zoom out ~2 levels. Pure + tested.

/** Street-level zoom when standing / crawling. */
export const NAV_ZOOM_MAX = 17;
/** Most zoomed-out view, reached at motorway speed. */
export const NAV_ZOOM_MIN = 15;
const SLOW_KMH = 20; // at or below: full street zoom
const FAST_KMH = 110; // at or above: widest view

/** Target zoom for a speed (km/h): linear between 20 and 110 km/h, 0.1-level steps. */
export function navZoomForSpeed(kmh: number): number {
  const f = Math.max(0, Math.min(1, (kmh - SLOW_KMH) / (FAST_KMH - SLOW_KMH)));
  return Math.round((NAV_ZOOM_MAX - f * (NAV_ZOOM_MAX - NAV_ZOOM_MIN)) * 10) / 10;
}

/**
 * Next camera zoom: moves toward the target but at most `maxStep` levels per GPS update, and
 * ignores changes under `dead` levels — so the map breathes smoothly instead of pumping at every
 * small speed change (e.g. 48→52 km/h in town).
 */
export function nextNavZoom(current: number, target: number, maxStep = 0.3, dead = 0.15): number {
  const d = target - current;
  if (Math.abs(d) < dead) return current;
  const step = Math.max(-maxStep, Math.min(maxStep, d));
  return Math.round((current + step) * 10) / 10;
}

/** Smoothed speed (km/h) from an exponential moving average; alpha = weight of the new sample. */
export function smoothSpeed(prevKmh: number | null, sampleKmh: number, alpha = 0.35): number {
  if (!Number.isFinite(sampleKmh) || sampleKmh < 0) return prevKmh ?? 0;
  const s = Math.min(sampleKmh, 200); // GPS jumps are not 300 km/h
  return prevKmh == null ? s : prevKmh + alpha * (s - prevKmh);
}
