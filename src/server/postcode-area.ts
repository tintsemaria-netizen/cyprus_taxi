import { prisma } from '@/lib/db';
import { activeBatch } from '@/server/osm/importer';

// The area of a postcode on the admin map (2026-11-21, operator: «фикс цены с индексами должны выделяться на карте»):
// the outline around every address of our own address base with that postcode. Points far from the rest (a mistyped
// postcode) are dropped first, so one stray address does not stretch the outline across the island.

type P = [number, number];
const cache = new Map<string, { at: number; poly: P[] | null }>();
const TTL_MS = 6 * 60 * 60 * 1000;

function hull(points: P[]): P[] {
  const pts = [...new Map(points.map((p) => [`${p[0].toFixed(5)},${p[1].toFixed(5)}`, p])).values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower: P[] = [], upper: P[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export async function postcodeArea(code: string, now = Date.now()): Promise<P[] | null> {
  const hit = cache.get(code);
  if (hit && now - hit.at < TTL_MS) return hit.poly;
  const batch = await activeBatch();
  let poly: P[] | null = null;
  if (batch !== null) {
    const rows = await prisma.osmPlace.findMany({ where: { batch, postcode: code }, select: { lat: true, lng: true }, take: 20000 });
    if (rows.length >= 3) {
      const cy = rows.reduce((a, r) => a + r.lat, 0) / rows.length, cx = rows.reduce((a, r) => a + r.lng, 0) / rows.length;
      const d = rows.map((r) => Math.hypot((r.lat - cy) * 111, (r.lng - cx) * 91));
      const med = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
      const keep = rows.filter((_, i) => d[i] <= Math.max(1.5, med * 3)).map((r) => [r.lat, r.lng] as P);
      const h = hull(keep.length >= 3 ? keep : rows.map((r) => [r.lat, r.lng] as P));
      poly = h.length >= 3 ? h : null;
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(code, { at: now, poly });
  return poly;
}
