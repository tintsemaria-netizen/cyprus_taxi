// Route line width by map zoom (2026-11-26, operator): thin when the map shows a whole region (the island view
// of a new order looked heavy), the full width only close up (navigation). One rule for Google and MapLibre.
export const ROUTE_STOPS: [number, number][] = [[9, 3], [12, 4.5], [14, 6], [15, 99]];

export function routeStroke(zoom: number | undefined, max: number): number {
  const z = zoom ?? 12;
  const pts = ROUTE_STOPS.map(([zz, w]) => [zz, Math.min(w, max)] as [number, number]);
  if (z <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [z1, w1] = pts[i]; const [z0, w0] = pts[i - 1];
    if (z <= z1) return w0 + ((w1 - w0) * (z - z0)) / (z1 - z0);
  }
  return Math.min(pts[pts.length - 1][1], max);
}

/** MapLibre paint expression for the same rule. */
export function routeStrokeExpr(max: number): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], ...ROUTE_STOPS.flatMap(([z, w]) => [z, Math.min(w, max)])];
}
