// Shared map marker for a vehicle: a generic top-down sedan (no third-party badge), used by
// both the MapLibre (MapView) and Google (GoogleMapView) maps so the car looks identical
// everywhere. It can be rotated to face its travel heading.
//
// 2026-11-14 palette: pearl-white body with a small lime roof light when free, a soft
// slate body when on a trip; neutral shadow instead of the lime glow. Slightly larger.

const DARK = '#1b2420'; // outline
const GLASS = '#22303a'; // tinted glass
const PEARL = '#F4F2EC'; // available: pearl white
const BUSY = '#9AA7B4'; // on a trip: soft slate
const ROOF = '#C8FF46'; // brand lime roof light (available only)

export type VehicleState = 'available' | 'busy';

/**
 * Top-down sedan, nose pointing up (north). `viewBox` is 40×44, the car
 * centred on (20, 22) so a heading rotation spins it about its own centre.
 */
function carSvg(body: string, heading = 0, roof = false): string {
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
    ${roof ? `<!-- taxi roof light --><rect x="16.6" y="21.2" width="6.8" height="3.4" rx="1.2" fill="${ROOF}" stroke="${DARK}" stroke-width="0.6"/>` : ''}
    <!-- taillights -->
    <path d="M15.4 36.4L18 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
    <path d="M24.6 36.4L22 37" stroke="#ff5a4d" stroke-width="1" stroke-linecap="round"/>
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
  const { state = 'available', stale = false, size = 42, heading = 0, title, tag } = opts;
  const busy = state === 'busy';
  const el = document.createElement('div');
  el.style.cssText =
    `position:relative;width:${size}px;height:${size}px;opacity:${stale ? 0.55 : 1};` +
    `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));transition:opacity .2s ease`;
  el.innerHTML = `<div class="car" style="width:100%;height:100%">${carSvg(busy ? BUSY : PEARL, heading, !busy)}</div>`;
  if (tag) {
    const t = document.createElement('div');
    t.textContent = tag;
    t.style.cssText =
      'position:absolute;left:50%;top:100%;transform:translate(-50%,1px);white-space:nowrap;' +
      'font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;' +
      `padding:1px 5px;border-radius:5px;background:${busy ? '#2a333b' : '#F4F2EC'};color:${busy ? '#e6ebef' : '#141b17'};` +
      'border:1px solid rgba(0,0,0,.35);pointer-events:none';
    el.appendChild(t);
  }
  if (title) el.title = title;
  return el;
}

/** Update an existing vehicle marker's heading in place (no re-create / flicker). */
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
