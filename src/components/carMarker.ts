// Shared map marker for the driver's vehicle: a top-down Mercedes sedan rendered in
// the brand palette (lime #C8FF46 on tinted glass), used by both the MapLibre
// (MapView) and Google (GoogleMapView) maps so the car looks identical everywhere.
//
// It replaces the old 🚕 emoji badge. The car floats on a soft lime glow and can be
// rotated to face its travel heading.

const DARK = '#0b1206'; // outline / shadow
const GLASS = '#0d1608'; // tinted greenhouse glass
const LIME = '#C8FF46'; // brand accent (available)
const BUSY = '#5b6b62'; // muted grey-green (on a trip)

export type VehicleState = 'available' | 'busy';

/**
 * Top-down Mercedes sedan, nose pointing up (north). `viewBox` is 40×44, the car
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
    <!-- three-pointed star on the hood -->
    <circle cx="20" cy="9.6" r="2.7" fill="${GLASS}"/>
    <circle cx="20" cy="9.6" r="2.7" fill="none" stroke="${body}" stroke-width="0.5"/>
    <g stroke="${body}" stroke-width="0.8" stroke-linecap="round">
      <path d="M20 9.6L20 7.6"/>
      <path d="M20 9.6L18.27 10.6"/>
      <path d="M20 9.6L21.73 10.6"/>
    </g>
    <!-- taillights -->
    <path d="M15.4 36.4L18 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
    <path d="M24.6 36.4L22 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
  </g>
</svg>`;
}

/**
 * Build the DOM element for a vehicle marker: the Mercedes SVG floating on a soft
 * lime glow. `size` is the on-map pixel size; `heading` (deg) rotates the car to
 * face its direction of travel.
 */
export function vehicleMarkerEl(opts: {
  state?: VehicleState;
  stale?: boolean;
  size?: number;
  heading?: number;
  title?: string;
}): HTMLElement {
  const { state = 'available', stale = false, size = 34, heading = 0, title } = opts;
  const body = state === 'busy' ? BUSY : LIME;
  const glow = state === 'busy' ? 0.1 : 0.28;
  const el = document.createElement('div');
  el.style.cssText =
    `width:${size}px;height:${size}px;opacity:${stale ? 0.55 : 1};` +
    `filter:drop-shadow(0 0 3px rgba(200,255,70,${glow})) drop-shadow(0 1px 2px rgba(0,0,0,0.5));` +
    `transition:opacity .2s ease`;
  el.innerHTML = carSvg(body, heading);
  if (title) el.title = title;
  return el;
}

/** Update an existing vehicle marker's heading in place (no re-create / flicker). */
export function setVehicleHeading(el: HTMLElement, heading: number): void {
  const g = el.querySelector('svg > g') as SVGGElement | null;
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
