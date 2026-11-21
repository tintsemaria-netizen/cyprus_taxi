// Fixed-price zone shapes, shared by the server (matching, saving) and the admin map (2026-11-21).

/** Relative area of a [lat, lng] polygon (shoelace, lng scaled by cos lat) — only for comparing zones. */
export function polygonArea(p: [number, number][]): number {
  if (p.length < 3) return Infinity;
  const k = Math.cos((p[0][0] * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [y1, x1] = p[i]; const [y2, x2] = p[(i + 1) % p.length];
    a += x1 * k * y2 - x2 * k * y1;
  }
  return Math.abs(a) / 2;
}

/** A circle of `radiusM` around a point as a 64-corner polygon (the stored shape of a price ring). */
export function circlePolygon(c: { lat: number; lng: number }, radiusM: number, n = 64): [number, number][] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [Math.round((c.lat + dLat * Math.cos(a)) * 1e6) / 1e6, Math.round((c.lng + dLng * Math.sin(a)) * 1e6) / 1e6] as [number, number];
  });
}
