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

## Next actions (optional, not blocking)
- Validate driver GPS on a physical phone over HTTPS; record result.
- Run the ~10-min synthetic load exercise; record machine/results.
- Configure a production map style + geocoder/router provider keys (server-only) and set DEMO_MODE=false when going real.
- Push the repository to GitHub once push credentials are available (`git push -u origin main`).

## Do not
- Do not publish secrets or the beta-access file to git.
- Do not disturb other vhosts/containers (agora, winzilla/fugaso, casino, etc.).
