// MapLibre GL 6 runs its tile parsing in a module Web Worker that imports "./maplibre-gl-shared.mjs".
// Turbopack emits those files with content hashes, so that relative import 404s and the worker never
// starts ("Worker failed to load"). We serve the two files unhashed from public/, under a versioned
// path, and point MapLibre at them with setWorkerUrl() (see src/lib/maplibre.ts). Runs before build/dev.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const dist = join(dirname(pkgPath), 'dist');
const base = join(process.cwd(), 'public', 'vendor', 'maplibre');
rmSync(base, { recursive: true, force: true }); // drop other versions
const out = join(base, version);
mkdirSync(out, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) cpSync(join(dist, f), join(out, f));
console.log(`[maplibre] worker ${version} → public/vendor/maplibre/${version}/`);
