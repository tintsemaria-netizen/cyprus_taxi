import type { MapMarker } from './MapView';

/** Fit signature: fixed points only; moving markers (vehicle, person) count by presence. */
export function fitKeyOf(markers: MapMarker[]): string {
  return markers.filter((m) => !m.noFit).map((m) => (m.kind === 'vehicle' || m.kind === 'person' ? m.kind[0] : `${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`)).join('|');
}

export type Pad = { top: number; right: number; bottom: number; left: number };

/**
 * Padding that always leaves a usable box (2026-11-23). When a sheet covers almost the whole map
 * (the booking «Выберите класс» panel), the bottom padding was taller than the map itself and the
 * map zoomed out to the whole world (Iraq, Afghanistan…). Keep at least `min` px (40) of the map free in
 * each direction by trimming the larger side first.
 */
export function safePadding(pad: Pad, width: number, height: number, min = 40): Pad {
  if (!width || !height) return pad;
  const fit = (a: number, b: number, size: number): [number, number] => {
    const over = a + b + min - size;
    if (over <= 0) return [a, b];
    const total = a + b || 1;
    const na = Math.max(0, Math.round(a - (over * a) / total));
    const nb = Math.max(0, Math.round(b - (over * b) / total));
    return [na, nb];
  };
  const [top, bottom] = fit(pad.top, pad.bottom, height);
  const [left, right] = fit(pad.left, pad.right, width);
  return { top, right, bottom, left };
}

/** The screen point the booking «centre pin» stands on (2026-11-23, operator): the middle of the visible
 *  part of the map between the overlays — the same point a padded focus centres on. */
export function pinPoint(pad: Pad | undefined, width: number, height: number): { x: number; y: number } {
  const p = pad ? safePadding(pad, width, height) : { top: 0, right: 0, bottom: 0, left: 0 };
  return { x: p.left + (width - p.left - p.right) / 2, y: p.top + (height - p.top - p.bottom) / 2 };
}
