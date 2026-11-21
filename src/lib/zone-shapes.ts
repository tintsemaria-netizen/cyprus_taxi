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

/** Centre of a polygon's corners. */
export function centroid(p: [number, number][]): [number, number] {
  return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
}

/** True when every corner of `inner` lies inside `outer` (ray casting) — «this zone sits inside that one». */
export function polygonInside(inner: [number, number][], outer: [number, number][]): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  const inPoly = ([y, x]: [number, number]) => {
    let c = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [yi, xi] = outer[i]; const [yj, xj] = outer[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return inner.every(inPoly);
}

/**
 * The next price belt (2026-11-21, operator: «следующие начинались там, где оканчивается предыдущая»):
 * the previous zone's own corners, densified to ≥ 24, each pushed outwards from the centre by `pushM` metres.
 * The admin then drags the outer edge where the next price should end; inside stays the previous zone (smallest wins).
 */
export function nextBelt(prev: [number, number][], pushM = 3000): [number, number][] {
  let pts = prev.slice();
  while (pts.length < 24) {
    const out: [number, number][] = [];
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; out.push(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); });
    pts = out;
  }
  const [cy, cx] = centroid(prev);
  const k = Math.cos((cy * Math.PI) / 180);
  return pts.map(([y, x]) => {
    const dy = (y - cy) * 111_320, dx = (x - cx) * 111_320 * k;
    const d = Math.hypot(dx, dy) || 1;
    const f = (d + pushM) / d;
    return [Math.round((cy + (dy * f) / 111_320) * 1e6) / 1e6, Math.round((cx + (dx * f) / (111_320 * k)) * 1e6) / 1e6] as [number, number];
  });
}
