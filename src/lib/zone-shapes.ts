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

// ---- Neighbouring zones follow each other (2026-11-21, operator) ----
// «Утянул внешнюю границу пояса на внутреннюю — внутренняя чуть стягивается внутрь» and the reverse: a zone pulled out
// over its belt pushes the belt out. Pure functions of (the edited polygon, the neighbour as it was) — so «↶ Шаг назад»
// on the edited polygon restores the neighbour too.

type P = [number, number];
const M_LAT = 111_320;

function inPoly([y, x]: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]; const [yj, xj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Nearest point on the polygon's edges, and the index of that edge (edge i = corner i → corner i+1). */
function nearestOnRing(p: P, ring: P[]): { pt: P; edge: number } {
  const k = Math.cos((p[0] * Math.PI) / 180);
  let best = { pt: ring[0], edge: 0, d: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
    const L = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L)) : 0;
    const qx = ax + t * (bx - ax), qy = ay + t * (by - ay);
    const d = (px - qx) ** 2 + (py - qy) ** 2;
    if (d < best.d) best = { pt: [qy, qx / k], edge: i, d };
  }
  return { pt: best.pt, edge: best.edge };
}

/** Moves p by `m` metres towards (m > 0) or away from (m < 0) the point c. */
function towards(p: P, c: P, m: number): P {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const dy = (c[0] - p[0]) * M_LAT, dx = (c[1] - p[1]) * M_LAT * k;
  const d = Math.hypot(dx, dy) || 1;
  const s = Math.min(m / d, 0.9);
  return [Math.round((p[0] + (dy * s) / M_LAT) * 1e6) / 1e6, Math.round((p[1] + (dx * s) / (M_LAT * k)) * 1e6) / 1e6];
}

function insertAt(poly: P[], edge: number, p: P): P[] { return [...poly.slice(0, edge + 1), p, ...poly.slice(edge + 1)]; }

const same = (a: P[], b: P[]) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/** The inner zone, pulled in wherever the (edited) belt around it cut into it; a ~`gapM` gap is left. */
export function shrinkInto(inner: P[], outer: P[], gapM = 60): P[] {
  if (inner.length < 3 || outer.length < 3) return inner;
  const c = centroid(inner);
  let res = inner.map((v) => (inPoly(v, outer) ? v : towards(nearestOnRing(v, outer).pt, c, gapM)));
  for (const o of outer) {
    if (!inPoly(o, res)) continue;
    const { edge } = nearestOnRing(o, res);
    res = insertAt(res, edge, towards(o, c, gapM));
  }
  return same(res, inner) ? inner : res;
}

/** The belt around, pushed out wherever the (edited) zone inside it went over its edge; a ~`gapM` gap is left. */
export function growAround(outer: P[], inner: P[], gapM = 60): P[] {
  if (inner.length < 3 || outer.length < 3) return outer;
  const c = centroid(outer);
  let res = outer.map((o) => (inPoly(o, inner) ? towards(nearestOnRing(o, inner).pt, c, -gapM) : o));
  for (const v of inner) {
    if (inPoly(v, res)) continue;
    const { edge } = nearestOnRing(v, res);
    res = insertAt(res, edge, towards(v, c, -gapM));
  }
  return same(res, outer) ? outer : res;
}
