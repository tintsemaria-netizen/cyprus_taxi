import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { queryWords } from '@/lib/placeFold';
import { activeBatch } from './importer';

// Search-as-you-type over the own Cyprus address base (2026-11-19). Every typed word must start a
// word of the place (name, other-language names, street, town, kind words, postcode). Ranking: the
// name itself matches > important kinds (towns, airport, hotels, hospitals…) > closer to the
// passenger > shorter names.

export interface OsmHit { label: string; secondary?: string; lat: number; lng: number; kind: string; postcode: string | null }

interface Row { name: string; kind: string; street: string | null; housenumber: string | null; locality: string | null; postcode: string | null; lat: number; lng: number }

export async function searchOsm(q: string, near: { lat: number; lng: number } | null, limit = 8): Promise<OsmHit[] | null> {
  const batch = await activeBatch();
  if (batch === null) return null; // base not loaded yet → caller falls back
  const words = queryWords(q).slice(0, 6);
  if (!words.length) return [];
  const all = Prisma.join(words.map((w) => Prisma.sql`"search" LIKE ${`% ${w}%`}`), ' AND ');
  const inName = Prisma.join(words.map((w) => Prisma.sql`"nameFold" LIKE ${`% ${w}%`}`), ' AND ');
  const first = `${words[0]}%`;
  const qlen = words.join(' ').length;
  const dist = near
    ? Prisma.sql`(CASE WHEN "kind" IN ('city', 'town', 'airport') THEN 0 ELSE LEAST(40, 0.8 * sqrt(power(("lat" - ${near.lat}) * 110.5, 2) + power(("lng" - ${near.lng}) * 91.0, 2))) END)`
    : Prisma.sql`0`;
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "name", "kind", "street", "housenumber", "locality", "postcode", "lat", "lng"
    FROM "OsmPlace"
    WHERE "batch" = ${batch} AND ${all}
    ORDER BY ("importance"
      + CASE WHEN ${inName} THEN 100 ELSE 0 END
      + CASE WHEN ltrim("nameFold") LIKE ${first} THEN 25 ELSE 0 END
      + CASE WHEN "nameFold" LIKE ${`% ${words.join(' ')} %`} THEN 60 ELSE 0 END
      - LEAST(20, GREATEST(0, length("nameFold") - ${qlen}) / 6.0)
      - ${dist}) DESC
    LIMIT ${limit * 2}`;
  const out: OsmHit[] = []; const seen = new Set<string>();
  for (const r of rows) {
    const addr = r.kind !== 'address' && r.street ? `${r.street}${r.housenumber ? ` ${r.housenumber}` : ''}` : null;
    const secondary = [addr, r.locality, r.postcode].filter(Boolean).join(', ') || undefined;
    const key = `${r.name}|${r.locality ?? ''}`.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    out.push({ label: r.name, secondary, lat: r.lat, lng: r.lng, kind: r.kind, postcode: r.postcode });
    if (out.length >= limit) break;
  }
  return out;
}

/** Postcode of the closest place in the base (≤ maxM metres), or null. */
export async function nearestPostcode(lat: number, lng: number, maxM = 600): Promise<string | null> {
  const batch = await activeBatch();
  if (batch === null) return null;
  const dLat = maxM / 110_500, dLng = maxM / 91_000;
  const rows = await prisma.$queryRaw<{ postcode: string }[]>`
    SELECT "postcode" FROM "OsmPlace"
    WHERE "batch" = ${batch} AND "postcode" IS NOT NULL
      AND "lat" BETWEEN ${lat - dLat} AND ${lat + dLat} AND "lng" BETWEEN ${lng - dLng} AND ${lng + dLng}
    ORDER BY power(("lat" - ${lat}) * 110.5, 2) + power(("lng" - ${lng}) * 91.0, 2)
    LIMIT 1`;
  return rows[0]?.postcode ?? null;
}
