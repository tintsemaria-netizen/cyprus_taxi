# Session handoff

## Current state (2026-09-11)
Beta is IMPLEMENTED, TESTED and DEPLOYED publicly at https://cyprustaxi.ackedberryes.store.
- Host: 92.39.53.229 (`hosted-by`). App runs as Docker Compose project `taxicy` (containers `taxicy-app`, `taxicy-db`), app bound to 127.0.0.1:8097, DB has no published port (volume `taxicy_pgdata`).
- nginx vhost `/etc/nginx/sites-available/cyprustaxi.conf` (symlinked in sites-enabled) routes only `cyprustaxi.ackedberryes.store` → app; self-signed origin cert in `/etc/nginx/taxicy-ssl/`. Cloudflare fronts the hostname and forwards to this origin.
- Secrets in `deploy/.env.production` (chmod 600, git-ignored). Test credentials in `deploy/secrets/beta-access.txt` (chmod 600, git-ignored).
- Project dir `/home/claudeuser/projects/cyprus_taxi` (owned by claudeuser). Git initialised; committed locally. Remote `origin` = github.com/tintsemaria-netizen/cyprus_taxi (NOT pushed — no push credentials in this environment).

## How to operate
- Status: `sudo docker compose --env-file deploy/.env.production ps`
- Logs: `sudo docker logs taxicy-app`
- Rebuild+redeploy: `sudo docker compose --env-file deploy/.env.production up -d --build`
- Migrations run automatically on container start (`prisma migrate deploy`).
- Re-seed demo / bootstrap admin: `docker compose ... exec -e DEMO_PASSWORD=… taxi-app npm run seed`; `... exec -e ADMIN_LOGIN=admin -e ADMIN_PASSWORD=… taxi-app npm run bootstrap:admin`.

## Task 004 (2026-09-11) — DONE
Applied the code-review corrections in docs/Tasks/Task.md: transaction rollback + row-lock
serialization in assignments.ts, atomic+encrypted idempotency (bookings.ts/tracking.ts/crypto.ts),
GPS pre-assignment/duty/ordering (location.ts), BookingApp focus + Nicosia-tz schedule
(timezone.ts), tracking no-fallback, origin guard (middleware), queue ordering, seed hardening,
and DB-test gating + regressions. Ran guarded legacy receipt migration (scripts/migrate-receipts.ts)
against prod. Rebuilt image, redeployed, smoke-tested live. Isolated test DB: run `taxi_cyprus_test`
in a throwaway postgres, `prisma migrate deploy`, `tsx prisma/seed.ts` (DEMO_MODE=true DEMO_PASSWORD=…),
then `DATABASE_URL=…_test npx vitest run`.

## Tasks 005 + 006 (2026-09-11) — DONE (code + deploy)
Deployed release e8463870 (see /api/v1/health/live `release`). 005: DST fold ambiguity
(timezone.ts + booking UI chooser), live-mode fixture gating, TrackApp outage/recovery,
GPS write-condition/create-retry + driver/vehicle row-lock guards for deactivation/binding,
health release id. 006: full-screen MapPicker (src/components/booking/MapPicker.tsx) +
/api/v1/places/reverse. 24/24 tests on isolated _test DB. UNVERIFIED and left for a session
with a real browser/phone: browser QA + mobile screenshots (Task 006), physical-device GPS,
10-min load test.

## Tasks 008 + 009 (2026-09-12) — DONE (code + browser QA + deploy)
Picker coord/address consistency (versioned draft) + lifecycle; fixed picker-not-loading
(container h-full — was 0-height → 300px canvas); map provider switched to Esri Dark Gray
(OSM 403s apps, Carto watermarks); Referrer-Policy strict-origin on pages / no-referrer on
/track+/api. Root Tasks/ folder created with index; pointer at docs/Tasks/. Browser QA via
Playwright in the official Docker image (host OS too old locally): `docs/BROWSER_QA.md`;
screenshots in `docs/qa-screenshots/`. Totals: vitest 24/24 + Playwright 6/6. Live release
2b8b455 verified (headers + real-tile picker). PENDING: physical Android/iPhone GPS, 10-min
load, real geocoding/routing provider.

## Task 010 (2026-09-12) — P0/P1 hotfix DONE + deployed; Google migration PENDING keys
Fixed picker flicker + endless "resolving…" (tolerance-based move detection; 350ms
debounced + deduped reverse; api-client AbortSignal + 8s timeout → coordinate fallback;
stable panel height; per-map generation guard; retry preserves draft). PlacesInput
request-identity + cancel-on-select/unmount. Europe/Nicosia schedule min (Intl). Strict
/places/reverse validation. Public-config retry UI. Release 149e821. Tests: vitest 24/24,
Playwright 10/10 (stability suite run against live). Map provider is MapTiler (streets-v2-dark).

**Google migration (Task 010 §C) NOT started — needs credentials.** To do it, provide a Google
Cloud project (billing on) with: Maps JavaScript API, Places API (New), Geocoding API, Routes API
enabled; a **browser key** website-restricted to https://cyprustaxi.ackedberryes.store (+ dev
origins); a **separate server key** (never NEXT_PUBLIC); and a **Map ID**. Then wire NEXT_PUBLIC_*
(browser key + Map ID) via Docker build args and server key via runtime env, update CSP for Google
hosts, and migrate all map surfaces + Places autocomplete + Geocoding reverse + Routes.

## Task 010 §C/D (2026-09-12) — Google Maps migration DONE + deployed
All map surfaces render Google Maps (browser key + Map ID, dark) via AutoMapView/
AutoMapPicker (MapLibre kept only as no-key dev fallback). GoogleMapPicker reuses the
stability invariants via Google idle/camera events. Backend adapters (server key,
src/server/google.ts): /places/reverse (reverse geocode), /places/search (forward
geocode, Cyprus-biased), /routes/estimate (Routes DRIVE, decoded polyline). Booking
renders the real road route + trip-duration estimate. Keys: NEXT_PUBLIC browser key +
Map ID via Docker build args; GOOGLE_MAPS_SERVER_API_KEY runtime env. Keys are in the
gitignored deploy/.env.production and docs/GoogleMaps only — NEVER committed. CSP updated
for Google hosts. Release 30f16fd. Verified live (map renders no-auth-errors; server
geocode/route 200; full search→route flow; stability 4/4; vitest 24/24).

Caveats / next: **Places API (New) is not enabled** on the Google project (autocomplete
blocked) → search uses Geocoding (real addresses, not typeahead). **Restrict the browser
key** to the beta hostname in the Google console. Physical-device GPS + load test still pending.

## Next actions (optional, not blocking)
- Validate driver GPS on a physical phone over HTTPS; record result.
- Run the ~10-min synthetic load exercise; record machine/results.
- Configure a production map style + geocoder/router provider keys (server-only) and set DEMO_MODE=false when going real.
- Push the repository to GitHub once push credentials are available (`git push -u origin main`).

## Do not
- Do not publish secrets or the beta-access file to git.
- Do not disturb other vhosts/containers (agora, winzilla/fugaso, casino, etc.).
