// Refresh the own Cyprus address base from OpenStreetMap (2026-11-19).
// Started by the worker once a week (separate process: the build needs a few hundred MB for a
// minute and must never stall dispatch). Manual run inside the app container:
//   node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/osm-import.ts [file.osm.pbf ...]
import { readFileSync } from 'node:fs';
import { runOsmImport } from '@/server/osm/importer';
import { prisma } from '@/lib/db';

async function main() {
  const files = process.argv.slice(2).map((f) => new Uint8Array(readFileSync(f)));
  const t0 = Date.now();
  const r = await runOsmImport(files.length ? files : undefined);
  console.log(`[osm-import] batch ${r.id}: ${r.rows} places, ${r.withPostcode} with postcode, ${Math.round((Date.now() - t0) / 1000)} s`);
}

main()
  .catch((e) => { console.error('[osm-import] failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
