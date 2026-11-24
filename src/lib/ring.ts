// Zone rings drawn by clicking (2026-11-24, operator: «чтобы она автоматом превращалась в круг, а не
// сворачивалась» — a figure-8). A new corner goes into the edge where it lengthens the ring least, and any
// crossing edges are untangled (2-opt), so the ring always stays one loop whatever order points are set in.

export type Pt = [number, number]; // [lat, lng]

const xy = (p: Pt, k: number): [number, number] => [p[1] * k, p[0]];
const dist = (a: Pt, b: Pt, k: number) => { const [ax, ay] = xy(a, k), [bx, by] = xy(b, k); return Math.hypot(ax - bx, ay - by); };
const kOf = (pts: Pt[]) => Math.cos(((pts.reduce((s, p) => s + p[0], 0) / Math.max(1, pts.length)) * Math.PI) / 180);

/** Insert `p` where it adds the least length to the closed ring. */
export function addToRing(poly: Pt[], p: Pt): Pt[] {
  if (poly.length < 3) return untangle([...poly, p]);
  const k = kOf([...poly, p]);
  let best = poly.length, bestCost = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cost = dist(a, p, k) + dist(p, b, k) - dist(a, b, k);
    if (cost < bestCost) { bestCost = cost; best = i + 1; }
  }
  return untangle([...poly.slice(0, best), p, ...poly.slice(best)]);
}

function cross(a: Pt, b: Pt, c: Pt, d: Pt, k: number): boolean {
  const [ax, ay] = xy(a, k), [bx, by] = xy(b, k), [cx, cy] = xy(c, k), [dx, dy] = xy(d, k);
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by), d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Remove self-crossings: reverse the stretch between two crossing edges until none are left. */
export function untangle(poly: Pt[]): Pt[] {
  const n = poly.length;
  if (n < 4) return poly;
  const r = poly.slice();
  const k = kOf(r);
  for (let guard = 0; guard < n * n; guard++) {
    let fixed = false;
    for (let i = 0; i < n && !fixed; i++) {
      for (let j = i + 2; j < n && !fixed; j++) {
        if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
        if (cross(r[i], r[i + 1], r[j], r[(j + 1) % n], k)) {
          // reverse i+1 … j
          for (let a = i + 1, b = j; a < b; a++, b--) [r[a], r[b]] = [r[b], r[a]];
          fixed = true;
        }
      }
    }
    if (!fixed) break;
  }
  return r;
}

export function selfCrossing(poly: Pt[]): boolean {
  const n = poly.length; if (n < 4) return false;
  const k = kOf(poly);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (cross(poly[i], poly[i + 1], poly[j], poly[(j + 1) % n], k)) return true;
  }
  return false;
}

/** Rounded outline (2026-11-24, operator: «чтобы круг закруглялся — красиво, клиенты видят»): Chaikin corner
 *  cutting on the closed ring. The rounded shape is also the one checked (what the passenger sees is what counts). */
export function smoothRing(poly: Pt[], iterations = 3): Pt[] {
  let r = poly;
  if (r.length < 3) return r;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r = out;
  }
  return r.map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6] as Pt);
}
