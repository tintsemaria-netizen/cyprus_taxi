# Taxi Cyprus — Beta release report

**Status: DEPLOYED — publicly reachable beta.** Date: 2026-09-11.
Release commit: `bad20ba88320b2e5242f4c7f20710de570fa44b5` (branch `main`, local; not yet pushed to GitHub — no push credentials in this environment). Repository: https://github.com/tintsemaria-netizen/cyprus_taxi

## Reachable URLs (live)

Public origin behind Cloudflare → nginx (host `92.39.53.229`) → isolated app container `127.0.0.1:8097`.

| Entry point | URL |
|---|---|
| Passenger booking | https://cyprustaxi.ackedberryes.store/ |
| Passenger tracking | https://cyprustaxi.ackedberryes.store/track (opened via a private tracking link) |
| Staff sign in | https://cyprustaxi.ackedberryes.store/staff/login |
| Dispatch queue + fleet | https://cyprustaxi.ackedberryes.store/dispatch |
| Driver app | https://cyprustaxi.ackedberryes.store/driver |
| Admin | https://cyprustaxi.ackedberryes.store/admin/drivers, /admin/vehicles, /admin/settings |
| Health | /api/v1/health/live, /api/v1/health/ready |

TLS is terminated at Cloudflare; the origin presents a self-signed certificate (`/etc/nginx/taxicy-ssl/`) accepted under Cloudflare "Full". Public HTTPS verified: `HTTP 200`, `server: cloudflare`, our CSP and `<title>Taxi Cyprus — book a ride</title>` returned.

## Test access

Test staff credentials are delivered privately in `deploy/secrets/beta-access.txt` on the server (git-ignored, chmod 600) — never committed. Admin has a unique strong password; demo dispatcher/drivers (`dispatcher`, `andreas`, `maria`, `petros`) share one demo password. This is a **synthetic demo / test service** with a conspicuous beta banner; do not enter real personal data.

Reproducible test journey:
1. Open `/` → set From "Limassol Marina", To "Larnaca Airport (LCA)" (type to search demo places), pick Comfort/XL, add name + `+357…` phone → Request a ride → Confirm. You are taken to `/track`.
2. In another session open `/staff/login` as `dispatcher` → `/dispatch` → open the new booking → Assign a driver (e.g. Andreas). If the driver has no fresh GPS you'll be warned and can confirm.
3. Open `/staff/login` as `andreas` on a phone (HTTPS) → Go on duty → Start sharing (grants real browser GPS) → drive statuses: on the way → arrived → start trip → complete.
4. The passenger `/track` view updates every ~5s: assigned car, live position, status, Call driver, Cancel (pre-pickup), and a completion summary.

## What is implemented

- Guest passenger booking with debounced place search (demo Cyprus fixtures), map pin selection, Now/Schedule, Comfort/XL, passenger count, name/phone/note.
- Server validation: service-area polygon, min 50 m stop distance, class capacity, schedule bounds (Europe/Nicosia display, UTC storage), E.164 phone parsing.
- Idempotent booking creation (`Idempotency-Key`), scoped tracking grant (256-bit token, digest-only storage, fragment→cookie exchange).
- Booking status machine with DB-enforced single active assignment (nullable-unique `active*` columns), optimistic revision checks, audit events, exceptional in-progress termination.
- Dispatcher queue + filters/search, fleet map, assign/reassign/unassign with reasons and GPS warning gate.
- Driver app: duty toggle, **real foreground `watchPosition` GPS** (coalesced ≤5 s, monotonic sequence, out-of-order/replay rejection, never simulated), sequential status actions, call passenger, external navigation link.
- Admin: drivers CRUD + one-time temporary passwords + reset (sessionVersion bump = instant logout), vehicles CRUD, exclusive vehicle binding, non-secret settings.
- Real MapLibre GL renderer with OSM raster demo tiles (attribution visible), graceful map-unavailable fallback.
- Security: bcrypt, HttpOnly SameSite cookies, DB-backed rate limits (booking/login/geocoder), CSP/security headers via middleware, separate passenger vs staff sessions, role checks in every route, request-id error envelope.
- PWA manifest + icons; polling every 5 s with visibility handling and reconnect.
- OpenAPI-shaped `/api/v1` surface, health endpoints, Docker + Compose, migrations, synthetic seed, admin bootstrap CLI.

## Test evidence (all run against a real Postgres)

- **Unit + DB integration (vitest): 12/12 passing** — status-machine legality, geo/service-area, freshness; DB-backed: idempotency (concurrent same-key → one booking), same-key-different-payload → 409, full REQUESTED→COMPLETED lifecycle persists, two concurrent assigns of one driver → exactly one wins (DB uniqueness).
- **Local HTTP E2E (curl):** booking → tracking exchange → dispatcher queue → GPS-warning gate → assign → passenger sees vehicle → driver GPS sample accepted, out-of-order rejected → passenger sees fresh location → EN_ROUTE→ARRIVED→IN_PROGRESS→COMPLETED → location revoked + driver freed on completion.
- **Authorization boundaries:** guest→dispatch = 401; driver→admin = 403; no tracking cookie = 401; illegal transition = 409; stale revision = 409; out-of-area booking rejected.
- **Public HTTPS smoke (through Cloudflare):** booking created (`CY-RQ9S-UMS2`), tracking view, dispatcher login + queue.
- **Persistence:** app container restarted → 3 bookings persisted, DB-backed session survived.

## Real vs simulated

- **Maps:** real MapLibre renderer + real OSM raster tiles (demo tile source; for production configure an authorized/vector provider with a server-side key). **Routing/geocoding are DEMO fixtures** (Cyprus place list; straight-line distance ETA labelled "estimate"), because no provider key is configured.
- **GPS:** real foreground browser geolocation for drivers. **Not yet validated on a physical phone in this run** — needs a real device on the HTTPS site; report it as pending, not verified.
- **DEMO_MODE=true:** conspicuous beta banner; synthetic seed data.

## Deployment specifics

- Isolated Docker Compose project `taxicy`: `taxicy-app` (Next.js) + `taxicy-db` (postgres:16, **no published port**, volume `taxicy_pgdata`), network `taxicy_net`. App bound to `127.0.0.1:8097` only.
- nginx vhost `/etc/nginx/sites-available/cyprustaxi.conf` routes **only** `cyprustaxi.ackedberryes.store` to the app; all other vhosts (agora, winzilla, casino, …) untouched — verified `nginx -t` OK and winzilla still serving.
- Secrets generated with `openssl rand`, stored in `deploy/.env.production` (chmod 600, git-ignored). No secrets in git.

## Limitations / outstanding

- Physical-device GPS and a production map/geocoder/router provider are pending configuration — do not represent tracking as production-verified.
- DNS/TLS depend on Cloudflare config (already forwarding to this origin); origin uses a self-signed cert (fine under CF Full, not Full-Strict).
- Operator must supply real privacy/terms, contacts, fares, and service-area polygon, and switch `DEMO_MODE=false` (with real integrations) before any real-customer launch. This build must not be described as legally compliant.
- No online payments, ratings, chat, SMS, background GPS, or automatic matching (out of beta scope).

## Rollback

- `cd /home/claudeuser/projects/cyprus_taxi && sudo docker compose --env-file deploy/.env.production down` stops the app (data persists in `taxicy_pgdata`).
- To remove the public route: `sudo rm /etc/nginx/sites-enabled/cyprustaxi.conf && sudo nginx -t && sudo systemctl reload nginx` (reverts the hostname to the previous default vhost).
- Previous image ids are retained by Docker; redeploy a prior build by tag if needed. Back up the DB before destructive schema changes: `sudo docker exec taxicy-db pg_dump -U taxi taxi_cyprus > backup.sql`.
