// Rounded route corners for display (2026-11-17): every bend of the route line becomes a small
// curve (radius ≤ ~25 m, so it stays on the road) instead of a sharp break. Input/output [lng, lat].

const R = 6_371_000;

export function smoothRoute(route: [number, number][] | null | undefined, maxCutM = 25): [number, number][] | null {
  if (!route || route.length < 3) return route ?? null;
  const lat0 = route[0][1];
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R;
  const xy = route.map(([lng, lat]) => [lng * kx, lat * ky] as [number, number]);
  // Drop repeated points (zero-length segments would break the cut maths).
  const pts: [number, number][] = [];
  for (const p of xy) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) pts.push(p); }
  if (pts.length < 3) return route;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    // Nearly straight → keep the point as is.
    const cos = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (l1 * l2);
    if (cos > 0.996) { out.push(b); continue; }
    const d = Math.min(maxCutM, l1 / 2, l2 / 2);
    const p0: [number, number] = [b[0] + ((a[0] - b[0]) * d) / l1, b[1] + ((a[1] - b[1]) * d) / l1];
    const p2: [number, number] = [b[0] + ((c[0] - b[0]) * d) / l2, b[1] + ((c[1] - b[1]) * d) / l2];
    const n = 6; // quadratic Bézier p0 → b (control) → p2
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out.map(([x, y]) => [x / kx, y / ky]);
}
