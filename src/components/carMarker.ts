// Shared map marker for a vehicle: a generic top-down sedan (no third-party badge), used by
// both the MapLibre (MapView) and Google (GoogleMapView) maps so the car looks identical
// everywhere. It can be rotated to face its travel heading.
//
// 2026-11-15 palette (owner's choice):
//  - other cars everywhere: white body;
//  - staff/dispatch map: free = white, on a trip = yellow;
//  - the driver's own car: a separate, more detailed model — silver-white body, dark glossy
//    roof/glass, red tail-light bar (selfCarSvg).

const DARK = '#2a2f35'; // outline
const GLASS = '#22303a'; // tinted glass
const WHITE = '#FFFFFF'; // available / every non-staff car
const BUSY = '#FFC83D'; // on a trip (staff map only): yellow

export type VehicleState = 'available' | 'busy' | 'self';

/**
 * Top-down sedan, nose pointing up (north). `viewBox` is 40×44, the car
 * centred on (20, 22) so a heading rotation spins it about its own centre.
 */
function carSvg(body: string, heading = 0): string {
  return `<svg viewBox="0 0 40 44" width="100%" height="100%" aria-hidden="true" style="overflow:visible">
  <g transform="rotate(${heading} 20 22)">
    <!-- body -->
    <path d="M20 4C23 4 25.2 4.8 26.2 7.5C27 9.8 27.3 11.5 27.6 14C28 17 28 19 28 22C28 26 27.8 29 27.2 32C26.6 35.2 24.5 37.2 22 38C21 38.3 19 38.3 18 38C15.5 37.2 13.4 35.2 12.8 32C12.2 29 12 26 12 22C12 19 12 17 12.4 14C12.7 11.5 13 9.8 13.8 7.5C14.8 4.8 17 4 20 4Z" fill="${body}" stroke="${DARK}" stroke-width="1.1"/>
    <!-- side mirrors -->
    <path d="M12.2 15.6L9.4 16.5L9.9 18.2L12.6 17.4Z" fill="${body}" stroke="${DARK}" stroke-width="0.7" stroke-linejoin="round"/>
    <path d="M27.8 15.6L30.6 16.5L30.1 18.2L27.4 17.4Z" fill="${body}" stroke="${DARK}" stroke-width="0.7" stroke-linejoin="round"/>
    <!-- headlights -->
    <path d="M15.2 6.4L17.4 7.1" stroke="${GLASS}" stroke-width="1" stroke-linecap="round"/>
    <path d="M24.8 6.4L22.6 7.1" stroke="${GLASS}" stroke-width="1" stroke-linecap="round"/>
    <!-- tinted glass greenhouse -->
    <rect x="14" y="14.2" width="12" height="16.8" rx="3" fill="${GLASS}"/>
    <!-- roofline bar splits windshield / rear glass -->
    <rect x="14" y="21.8" width="12" height="2.2" fill="${body}"/>
    <!-- hood crease -->
    <path d="M17.2 8.6Q20 10.2 22.8 8.6" fill="none" stroke="${DARK}" stroke-width="0.5" opacity="0.45"/>
    <!-- taillights -->
    <path d="M15.4 36.4L18 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
    <path d="M24.6 36.4L22 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
  </g>
</svg>`;
}

/**
 * The driver's own car (2026-11-15): a smoother top-down model in silver-white with a dark
 * glossy cabin and a red tail-light bar. Same 40×44 viewBox and rotation centre as carSvg.
 */
function selfCarSvg(heading = 0): string {
  return `<svg viewBox="0 0 40 44" width="100%" height="100%" aria-hidden="true" style="overflow:visible">
  <defs>
    <linearGradient id="ilyBody" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#B9BEC4"/><stop offset="0.18" stop-color="#E9ECEF"/>
      <stop offset="0.5" stop-color="#F7F8F9"/><stop offset="0.82" stop-color="#E9ECEF"/><stop offset="1" stop-color="#B9BEC4"/>
    </linearGradient>
    <radialGradient id="ilyCabin" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#5E636B"/><stop offset="0.55" stop-color="#2C3036"/><stop offset="1" stop-color="#121417"/>
    </radialGradient>
    <linearGradient id="ilyShine" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.28"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g transform="rotate(${heading} 20 22)">
    <!-- mirrors -->
    <path d="M12.6 13.2L9.2 14.6L9.6 15.9L12.8 15Z" fill="#D9DDE1" stroke="#8E949B" stroke-width="0.5" stroke-linejoin="round"/>
    <path d="M27.4 13.2L30.8 14.6L30.4 15.9L27.2 15Z" fill="#D9DDE1" stroke="#8E949B" stroke-width="0.5" stroke-linejoin="round"/>
    <!-- body: rounded nose, straight flanks, square tail -->
    <path d="M20 3.6C24.6 3.6 27.6 5 27.9 8.6L28.2 34.2C28.2 37 26.6 38.4 23.6 38.6L16.4 38.6C13.4 38.4 11.8 37 11.8 34.2L12.1 8.6C12.4 5 15.4 3.6 20 3.6Z" fill="url(#ilyBody)" stroke="#9AA0A7" stroke-width="0.6"/>
    <!-- red tail-light bar -->
    <path d="M12.6 35.6C12.9 37.5 14.4 38.3 16.4 38.4L23.6 38.4C25.6 38.3 27.1 37.5 27.4 35.6L27.4 37C27.2 38.8 25.6 39.6 23.6 39.7L16.4 39.7C14.4 39.6 12.8 38.8 12.6 37Z" fill="#E0262B"/>
    <!-- dark glossy cabin (windscreen + roof + rear glass in one piece) -->
    <path d="M20 9.4C23.4 9.4 25.4 10.4 25.6 12.8L25.9 30.6C25.9 33.2 24.4 34.4 20 34.4C15.6 34.4 14.1 33.2 14.1 30.6L14.4 12.8C14.6 10.4 16.6 9.4 20 9.4Z" fill="url(#ilyCabin)"/>
    <path d="M20 9.9C22.9 9.9 24.6 10.7 24.8 12.6L24.9 17C23.4 15.9 21.8 15.5 20 15.5C18.2 15.5 16.6 15.9 15.1 17L15.2 12.6C15.4 10.7 17.1 9.9 20 9.9Z" fill="url(#ilyShine)"/>
    <!-- door seams -->
    <path d="M12.4 20.5L13.6 20.5M27.6 20.5L26.4 20.5M12.5 27L13.7 27M27.5 27L26.3 27" stroke="#A3A9B0" stroke-width="0.5" stroke-linecap="round"/>
  </g>
</svg>`;
}

/**
 * Build the DOM element for a vehicle marker. `size` is the on-map pixel size; `heading`
 * (deg) rotates the car to face its direction of travel; `tag` (e.g. the plate number)
 * is shown as a small label under the car (admin/dispatch maps).
 */
export function vehicleMarkerEl(opts: {
  state?: VehicleState;
  stale?: boolean;
  size?: number;
  heading?: number;
  title?: string;
  tag?: string;
}): HTMLElement {
  // Car sizes: 2026-11-14 doubled (42→84, fleet 36→72); 2026-11-15 −15% (84→71, fleet 72→61).
  const { state = 'available', stale = false, size = 71, heading = 0, title, tag } = opts;
  const busy = state === 'busy';
  const self = state === 'self';
  const el = document.createElement('div');
  el.style.cssText =
    `position:relative;width:${size}px;height:${size}px;opacity:${stale ? 0.55 : 1};` +
    `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));transition:opacity .2s ease`;
  if (self) el.style.zIndex = '1000'; // own car stays above other cars at every zoom level
  el.innerHTML = `<div class="car" style="width:100%;height:100%">${self ? selfCarSvg(heading) : carSvg(busy ? BUSY : WHITE, heading)}</div>`;
  if (tag) {
    const t = document.createElement('div');
    t.textContent = tag;
    t.style.cssText =
      'position:absolute;left:50%;top:100%;transform:translate(-50%,1px);white-space:nowrap;' +
      'font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;' +
      `padding:1px 5px;border-radius:5px;background:${busy ? '#FFC83D' : '#FFFFFF'};color:#141b17;` +
      'border:1px solid rgba(0,0,0,.35);pointer-events:none';
    el.appendChild(t);
  }
  if (title) el.title = title;
  return el;
}

/** Update an existing vehicle marker's heading in place (no re-create / flicker). */
/**
 * Point a car along its direction of travel ON SCREEN (2026-11-15 fix). Marker content is drawn
 * in screen space, but the navigation map is rotated heading-up, so the car's rotation must be
 * its compass bearing minus the map's own heading — otherwise it lies sideways across the road.
 * The compass bearing is remembered on the element so map rotations can re-apply it.
 */
export function orientVehicle(el: HTMLElement, mapHeading: number, bearingDeg?: number): void {
  if (bearingDeg != null && Number.isFinite(bearingDeg)) el.dataset.bearing = String(bearingDeg);
  const b = Number(el.dataset.bearing);
  if (!Number.isFinite(b)) return;
  setVehicleHeading(el, ((b - mapHeading) % 360 + 360) % 360);
}

export function setVehicleHeading(el: HTMLElement, heading: number): void {
  const g = el.querySelector('.car svg > g') as SVGGElement | null;
  if (g) g.setAttribute('transform', `rotate(${heading} 20 22)`);
}

/** Bearing in degrees (0 = north, clockwise) from one lat/lng to the next. */
export function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const φ1 = from.lat * toRad;
  const φ2 = to.lat * toRad;
  const Δλ = (to.lng - from.lng) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * "You are here" person marker (2026-11-15): a blue disc with a simple standing-figure pictogram
 * and a soft halo. Used for the passenger's live position on their own map and, when the
 * passenger chooses to share it, on the driver's map before pickup. Centred on its point.
 */
export function personMarkerEl(opts: { title?: string; size?: number; stale?: boolean } = {}): HTMLElement {
  const { title, size = 34, stale = false } = opts;
  const el = document.createElement('div');
  el.style.cssText =
    `width:${size}px;height:${size}px;opacity:${stale ? 0.55 : 1};` +
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));z-index:900;transition:opacity .2s ease';
  el.innerHTML = `<svg viewBox="0 0 34 34" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="17" cy="17" r="16" fill="rgba(76,154,255,0.22)"/>
    <circle cx="17" cy="17" r="12" fill="#4C9AFF" stroke="#ffffff" stroke-width="2.4"/>
    <circle cx="17" cy="11.6" r="2.6" fill="#ffffff"/>
    <path d="M13.2 22.6v-4.3q0-3.2 3.8-3.2t3.8 3.2v4.3h-1.9v3.4h-3.8v-3.4z" fill="#ffffff"/>
  </svg>`;
  if (title) el.title = title;
  return el;
}
