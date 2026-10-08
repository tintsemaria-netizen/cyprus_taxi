// Single entry point for loading MapLibre on the client: also points its Web Worker at the unhashed
// copies in public/vendor/maplibre/<version>/ (scripts/copy-maplibre-worker.mjs) — required under
// Turbopack, where the bundled worker's relative import of its shared chunk would 404.
let configured = false;

export async function loadMaplibre() {
  const m = await import('maplibre-gl');
  if (!configured) {
    m.setWorkerUrl(`/vendor/maplibre/${m.getVersion()}/maplibre-gl-worker.mjs`);
    configured = true;
  }
  return m;
}
