// Smooth car movement along the drawn route (2026-11-17). GPS updates stay economical (every ~5 s);
// between two updates the car glides along the route line instead of jumping in a straight line.

type LL = { lat: number; lng: number };

const R = 6_371_000;
function toXY(p: LL, lat0: number): [number, number] {
  return [((p.lng * Math.PI) / 180) * R * Math.cos((lat0 * Math.PI) / 180), ((p.lat * Math.PI) / 180) * R];
}

/** Nearest point on the polyline: distance from the start along the line (m) and offset from it (m). */
function project(line: LL[], cum: number[], p: LL, lat0: number): { s: number; off: number } {
  const [px, py] = toXY(p, lat0);
  let best = { s: 0, off: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toXY(line[i], lat0);
    const [bx, by] = toXY(line[i + 1], lat0);
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    const off = Math.hypot(px - qx, py - qy);
    if (off < best.off) best = { s: cum[i] + t * Math.sqrt(L2), off };
  }
  return best;
}

/**
 * A function t∈[0,1] → position for the glide from `from` to `to`: along `route` ([lng, lat][]) when
 * both points lie on it (≤ 40 m off) and the car moves forward, otherwise a straight line.
 */
export function glidePath(from: LL, to: LL, route?: [number, number][] | null): (t: number) => LL {
  const straight = (t: number) => ({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
  if (!route || route.length < 2) return straight;
  const line = route.map(([lng, lat]) => ({ lat, lng }));
  const lat0 = line[0].lat;
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toXY(line[i - 1], lat0);
    const [bx, by] = toXY(line[i], lat0);
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const a = project(line, cum, from, lat0);
  const b = project(line, cum, to, lat0);
  const [fx, fy] = toXY(from, lat0);
  const [tx, ty] = toXY(to, lat0);
  const direct = Math.hypot(tx - fx, ty - fy);
  // Off the line, going backwards, or a detour far longer than the real move → straight line.
  if (a.off > 40 || b.off > 40 || b.s <= a.s || b.s - a.s > direct * 3 + 60) return straight;
  const at = (s: number): LL => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const k = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
    return { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * k, lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * k };
  };
  // Keep the GPS offsets from the line (fading from the start offset to the end one), so the car
  // neither jumps onto the line at the start nor off it at the end.
  const a0 = at(a.s), b0 = at(b.s);
  const da = { lat: from.lat - a0.lat, lng: from.lng - a0.lng };
  const db = { lat: to.lat - b0.lat, lng: to.lng - b0.lng };
  return (t: number) => {
    if (t >= 1) return to;
    if (t <= 0) return from;
    const p = at(a.s + (b.s - a.s) * t);
    return { lat: p.lat + da.lat * (1 - t) + db.lat * t, lng: p.lng + da.lng * (1 - t) + db.lng * t };
  };
}
