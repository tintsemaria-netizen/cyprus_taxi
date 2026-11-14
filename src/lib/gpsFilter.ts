// Client-side GPS fix filter for the driver app (2026-11-14).
//
// Phones in a city often report fixes that land on the neighbouring street: multipath near
// buildings, or a Wi-Fi/cell fallback with 100–1000 m error. This filter decides which raw fix
// becomes "the driver's position" (sent to the server, drawn on the maps):
//   1. A poor fix (accuracy > POOR_M) is ignored while a good fix is recent (< GOOD_HOLD_MS).
//      Without a recent good fix, the poor one is still used — a rough position beats none.
//   2. A sudden jump is ignored: implied speed > MAX_SPEED_MS and distance > JUMP_M.
//      If JUMP_CONFIRM jumps in a row agree, it is real (e.g. after a tunnel) and is accepted.
// Pure and deterministic, so it is unit-tested.

export const POOR_M = 50;
export const GOOD_HOLD_MS = 30_000;
export const MAX_SPEED_MS = 50; // 180 km/h
export const JUMP_M = 60;
export const JUMP_CONFIRM = 3;

export interface Fix { lat: number; lng: number; accuracyM: number; t: number }
export interface FilterState { last: Fix | null; lastGoodAt: number | null; jumpRun: number }
export type Verdict = 'accept' | 'poor' | 'jump';

export const initialFilterState = (): FilterState => ({ last: null, lastGoodAt: null, jumpRun: 0 });

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function filterFix(s: FilterState, fix: Fix): { verdict: Verdict; state: FilterState } {
  const good = fix.accuracyM <= POOR_M;
  if (!good && s.lastGoodAt !== null && fix.t - s.lastGoodAt < GOOD_HOLD_MS) {
    return { verdict: 'poor', state: s };
  }
  if (s.last) {
    const d = distanceM(s.last, fix);
    const dt = Math.max(1, (fix.t - s.last.t) / 1000);
    if (d > JUMP_M && d / dt > MAX_SPEED_MS && s.jumpRun + 1 < JUMP_CONFIRM) {
      return { verdict: 'jump', state: { ...s, jumpRun: s.jumpRun + 1 } };
    }
  }
  return { verdict: 'accept', state: { last: fix, lastGoodAt: good ? fix.t : s.lastGoodAt, jumpRun: 0 } };
}

/** Short quality label for the UI. */
export function accuracyLevel(accuracyM: number | null): 'good' | 'fair' | 'poor' | null {
  if (accuracyM == null) return null;
  return accuracyM <= 20 ? 'good' : accuracyM <= POOR_M ? 'fair' : 'poor';
}
