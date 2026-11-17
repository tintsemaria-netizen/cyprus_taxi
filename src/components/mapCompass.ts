// Compass button for maps the user can rotate with two fingers (2026-11-17).
// Shown only while the map is turned away from north; tap → turn back to north.
// The needle (lime = north) turns with the map so it always points at real north.

export function compassEl(label: string, onClick: () => void): { el: HTMLButtonElement; update: (heading: number) => void } {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.dataset.testid = 'map-compass';
  el.style.cssText = [
    'display:none', 'width:40px', 'height:40px', 'margin:12px', 'padding:0', 'border-radius:9999px',
    'border:1px solid rgba(255,255,255,.14)', 'background:rgba(16,25,28,.92)', 'box-shadow:0 2px 8px rgba(0,0,0,.4)',
    'cursor:pointer', 'align-items:center', 'justify-content:center', 'pointer-events:auto',
  ].join(';');
  el.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style="transition:transform .15s linear">' +
    '<path d="M11 2 L15 11 L7 11 Z" fill="#C8FF46"/>' +
    '<path d="M11 20 L7 11 L15 11 Z" fill="#8A969A"/>' +
    '</svg>';
  const svg = el.firstChild as SVGElement;
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  // Swallow the press so it is not taken as a map tap / gesture start.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  const update = (heading: number) => {
    const h = ((heading % 360) + 360) % 360;
    const rotated = h > 1 && h < 359;
    el.style.display = rotated ? 'flex' : 'none';
    svg.style.transform = `rotate(${-h}deg)`;
  };
  return { el, update };
}

/** Shortest-way ease of a heading back to north. */
export function easeHeadingToNorth(get: () => number, set: (h: number) => void, ms = 400): void {
  const from = ((get() % 360) + 540) % 360 - 180; // −180..180
  if (Math.abs(from) < 0.5) { set(0); return; }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const e = t * (2 - t);
    set(from * (1 - e));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
