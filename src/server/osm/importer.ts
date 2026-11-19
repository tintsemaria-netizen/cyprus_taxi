import { prisma } from '@/lib/db';
import { buildPlaces } from './extract';

// Weekly refresh of the own Cyprus address base (2026-11-19). Downloads the OpenStreetMap extracts
// (south + north), builds the rows and swaps them in as a new batch; search keeps using the old
// batch until the new one is complete. Data © OpenStreetMap contributors (ODbL).

const DEFAULT_SOURCES = [
  // movisda.io: daily extracts by admin area. CY = Republic of Cyprus, CY-XX = the north.
  'https://osm.download.movisda.io/admin/CY-latest.osm.pbf',
  'https://osm.download.movisda.io/admin/CY-XX-latest.osm.pbf',
];
// Whole island in one file, used if the extracts above cannot be fetched.
const FALLBACK_SOURCES = ['https://download.geofabrik.de/europe/cyprus-latest.osm.pbf'];

export const REFRESH_DAYS = 7;

async function download(url: string): Promise<Uint8Array> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10 * 60_000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'IL-Y taxi address base (il-y.taxi)' } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length < 100_000) throw new Error(`${url}: only ${b.length} bytes`);
    return b;
  } finally { clearTimeout(t); }
}

async function fetchAll(): Promise<Uint8Array[]> {
  const env = process.env.OSM_SOURCES?.split(',').map((s) => s.trim()).filter(Boolean);
  try { return await Promise.all((env?.length ? env : DEFAULT_SOURCES).map(download)); }
  catch (e) {
    if (env?.length) throw e;
    console.warn('[osm] primary sources failed, using fallback:', (e as Error).message);
    return Promise.all(FALLBACK_SOURCES.map(download));
  }
}

/** Run one import end-to-end. `files` lets tests/one-off runs pass local extracts. */
export async function runOsmImport(files?: Uint8Array[]): Promise<{ id: number; rows: number; withPostcode: number }> {
  const run = await prisma.osmImport.create({ data: {} });
  try {
    const bufs = files ?? await fetchAll();
    const rows = buildPlaces(bufs);
    bufs.length = 0;
    if (rows.length < 1000 && !files) throw new Error(`only ${rows.length} places — refusing to replace the base`);
    for (let i = 0; i < rows.length; i += 2000) {
      await prisma.osmPlace.createMany({ data: rows.slice(i, i + 2000).map((r) => ({ batch: run.id, ...r })) });
    }
    const withPostcode = rows.filter((r) => r.postcode).length;
    await prisma.osmImport.update({ where: { id: run.id }, data: { status: 'DONE', finishedAt: new Date(), rows: rows.length, withPostcode } });
    await prisma.osmPlace.deleteMany({ where: { batch: { not: run.id } } });
    await prisma.$executeRawUnsafe('ANALYZE "OsmPlace"');
    resetActiveBatchCache();
    await backfillOpenBookings().catch((e) => console.error('[osm] postcode backfill', e));
    return { id: run.id, rows: rows.length, withPostcode };
  } catch (e) {
    await prisma.osmImport.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String((e as Error).message ?? e).slice(0, 500) } });
    await prisma.osmPlace.deleteMany({ where: { batch: run.id } });
    throw e;
  }
}

/** Orders still in play without a destination postcode get one from the fresh base. */
async function backfillOpenBookings() {
  const { nearestPostcode } = await import('./search');
  const open = await prisma.booking.findMany({
    where: { dropoffPostcode: null, status: { in: ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
    select: { id: true, dropoffLat: true, dropoffLng: true }, take: 5000,
  });
  for (const b of open) {
    const pc = await nearestPostcode(b.dropoffLat, b.dropoffLng, 600);
    if (pc) await prisma.booking.update({ where: { id: b.id }, data: { dropoffPostcode: pc } });
  }
}

/** Is an import due? (no base yet, base older than a week; failed runs retried after 6 h) */
export async function osmImportDue(now = new Date()): Promise<boolean> {
  const running = await prisma.osmImport.findFirst({ where: { status: 'RUNNING', startedAt: { gt: new Date(now.getTime() - 3 * 3600_000) } } });
  if (running) return false;
  const failed = await prisma.osmImport.findFirst({ where: { status: 'FAILED', finishedAt: { gt: new Date(now.getTime() - 6 * 3600_000) } } });
  if (failed) return false;
  const done = await prisma.osmImport.findFirst({ where: { status: 'DONE' }, orderBy: { id: 'desc' } });
  return !done || !done.finishedAt || now.getTime() - done.finishedAt.getTime() > REFRESH_DAYS * 86_400_000;
}

/** Latest complete batch id (cached 60 s), or null while the base is still empty. */
let cached: { at: number; batch: number | null } | null = null;
export async function activeBatch(): Promise<number | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.batch;
  const done = await prisma.osmImport.findFirst({ where: { status: 'DONE' }, orderBy: { id: 'desc' }, select: { id: true } });
  cached = { at: Date.now(), batch: done?.id ?? null };
  return cached.batch;
}
export function resetActiveBatchCache() { cached = null; }
