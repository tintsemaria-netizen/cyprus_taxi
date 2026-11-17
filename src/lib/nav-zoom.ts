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

/** Closest zoom, reached right at the pickup / drop-off / stop. */
export const NAV_ZOOM_ARRIVE = 18.5;
const APPROACH_START_M = 600; // the map starts closing in this far from the point
const APPROACH_END_M = 80; // fully zoomed in from here on

/**
 * Approach zoom (2026-11-17): over the last ~600 m to the pickup / drop-off the map closes in
 * gradually, street level → 1.5 levels closer, so the driver sees the exact spot and entrance.
 * Never zooms out compared with the speed zoom.
 */
export function navZoomForApproach(remainingM: number | null | undefined): number | null {
  if (remainingM == null || !Number.isFinite(remainingM) || remainingM > APPROACH_START_M) return null;
  const f = Math.max(0, Math.min(1, (APPROACH_START_M - remainingM) / (APPROACH_START_M - APPROACH_END_M)));
  return Math.round((NAV_ZOOM_MAX + f * (NAV_ZOOM_ARRIVE - NAV_ZOOM_MAX)) * 10) / 10;
}

/** Camera zoom target: the speed zoom, closed in further while approaching the point. */
export function navZoomTarget(kmh: number, remainingM: number | null | undefined): number {
  const s = navZoomForSpeed(kmh), a = navZoomForApproach(remainingM);
  return a == null ? s : Math.max(s, a);
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
