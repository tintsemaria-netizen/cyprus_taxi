import type { MapMarker } from './MapView';

/** Fit signature: fixed points only; moving markers (vehicle, person) count by presence. */
export function fitKeyOf(markers: MapMarker[]): string {
  return markers.filter((m) => !m.noFit).map((m) => (m.kind === 'vehicle' || m.kind === 'person' ? m.kind[0] : `${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`)).join('|');
}
