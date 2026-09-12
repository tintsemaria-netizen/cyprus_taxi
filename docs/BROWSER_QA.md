# Browser QA — IL-Yas map picker (Task 008)

Real-browser interaction/layout evidence for the full-screen map picker.

## Why Docker

This host is Ubuntu 20.04, which Playwright's current browser binaries no longer
support (`Playwright does not support chromium on ubuntu20.04-x64`). So the browser
runs inside the **official Playwright image**, targeting a local instance of the
production build over `--network host`.

## How to reproduce

```bash
# 1. Isolated test DB + seed (never the production DB)
docker run -d --name qa-pg -e POSTGRES_USER=taxi -e POSTGRES_PASSWORD=qapass \
  -e POSTGRES_DB=taxi_cyprus_test -p 127.0.0.1:55470:5432 postgres:16-alpine
export DATABASE_URL="postgresql://taxi:qapass@localhost:55470/taxi_cyprus_test?schema=public"
export SESSION_SECRET=$(openssl rand -hex 32) TRACKING_RECEIPT_SECRET=$(openssl rand -hex 32) DEMO_MODE=true DEMO_PASSWORD=qa
npx prisma migrate deploy && npx tsx prisma/seed.ts

# 2. Run the production build locally
npm run build && node_modules/.bin/next start -p 3065 &

# 3. Run the browser suite in the Playwright image
docker run --rm --network host -v "$PWD/tests-e2e:/work" -w /work \
  -e QA_BASE_URL=http://localhost:3065 mcr.microsoft.com/playwright:v1.49.0-jammy \
  sh -c "npm i --no-save @playwright/test@1.49.0 >/dev/null 2>&1; npx playwright test --config=playwright.config.ts"
```

## Results (2026-09-12)

`chromium — 6 passed`:

1. **layout** — no horizontal overflow at 1440×900, 390×844 and 360px.
2. **screenshots** — desktop + mobile booking captured.
3. **picker opens full-screen for BOTH fields** — header/My-location/Confirm visible; Back returns to the form.
4. **form + other stop survive confirm** — name/phone preserved, destination populated after a map confirm (geolocation **mocked**: granted + fixed Cyprus position).
5. **REGRESSION (coord/address consistency)** — reverse-geocode delayed 3 s returning a bogus label; moving then confirming before it resolves yields a `Pin lat,lng` coordinate label, never the stale address. (`/api/v1/places/reverse` intercepted — labelled mocked.)
6. **real tiles load (HTTP 200)** — actual network fetch of the configured Esri Dark Gray tiles; asserts ≥1 tile 200 and zero blocked/failed. This is a **real external tile load**, not mocked.

Screenshots: `docs/qa-screenshots/` (desktop-booking, mobile-booking, mobile-picker-pickup, mobile-picker-destination). They show the real implementation (IL-Yas branding, Esri dark basemap, lime centre pin, coordinate fallback panel).

## Tile provider note

OpenStreetMap's volunteer tile servers block app/datacenter usage (HTTP 403 "tile
usage policy"), and Carto's public tiles are now watermarked "API key required".
The demo basemap therefore uses **Esri World Dark Gray Canvas** (no key, no
watermark, attribution "Tiles © Esri · © OpenStreetMap contributors"). This remains
a demo basemap; a licensed/authorized provider should be configured for production
via `NEXT_PUBLIC_MAP_TILES` / `NEXT_PUBLIC_MAP_ATTRIBUTION`.

## Not covered here

- **Physical Android Chrome / iPhone Safari** — requires real devices; **pending** (emulation is not a physical-device GPS test).
- **~10-minute load exercise** and **real geocoding/routing provider** — separate pending work, tracked in `Tasks/`.
