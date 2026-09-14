# Session handoff

## Tasks 013/014/015 completion pass (2026-09-14) — release 31d5781, vitest 78/78, live-verified
- **013 reliability**: chat send validates chat-open + active-assignment ownership ATOMICALLY under the booking row lock (`postMessage(..., {requireDriverId})`); notifications go through a durable **NotificationOutbox** (enqueue in domain writes; worker drains with retries/backoff + dedupe; drops stale/expired offers). DONE.
- **014 passenger accounts**: `Passenger`/`PassengerSession` + SMS OTP; **booking now REQUIRES a signed-in passenger** (`401 LOGIN_REQUIRED`, verified live) with a login modal after route selection; account-linked bookings; **"My rides"** (`/rides`) history + resume-live-tracking; **destination history** chips. Nav Staff→Login, My ride→My rides. See Tasks/014.
- **015 completion**: malware-scan GATE (clamd adapter; accept requires `scanStatus=CLEAN`; approval requires all required docs CLEAN — never approve unscanned); **expiry enforcement** (admin sets doc expiry on accept; worker → `DOCUMENTS_EXPIRED`, off-duty, invalidates unaccepted offers, never cancels an active trip; 30/7/1-day reminders via outbox); concurrency-safe review (request-changes/reject revision-guarded under row lock); wizard **autosave**; expanded document fields/slots.
- **Migration** `20260914085416_t013_t014_t015_completion` (Passenger, PassengerSession, NotificationOutbox, Booking.passengerId, ApplicationDocument.expiresAt).
- **HARD EXTERNAL BLOCKERS (not done, not faked)**: (1) **real SMS** needs `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN` (only Verify SID present) — dev OTP is refused unless `SMS_ALLOW_DEV_OTP=true` and is labelled "Test verification"; the beta enables it (labelled) to stay usable. (2) **real malware scanning** needs a reachable clamd (`CLAMAV_HOST`) — none here, so scans are UNAVAILABLE and approval is correctly blocked. Both capabilities are implemented and gate correctly; they light up when the external resource is provided.

## Task 015 (2026-09-14) — Driver registration + KYC + admin approval — IMPLEMENTED + deployed
Release **21868e1**. vitest **75/75**. Live-verified on prod.
- **Eligibility gate** `Driver.eligibility` (LEGACY|APPROVED|PENDING|SUSPENDED|DOCUMENTS_EXPIRED); only LEGACY/APPROVED work — enforced at duty, public fleet, candidate selection, market supply, offer accept (in-tx), manual assign/reassign (`src/lib/eligibility-policy.ts`). Migration `20260914110013_driver_applications_kyc` grandfathers pre-existing drivers to **LEGACY atomically** (owner decision) — all 5 prod drivers = LEGACY, no lockout. New self-reg is gated (Driver created only, APPROVED, on admin approval).
- **Applicant accounts + OTP**: `DriverApplicant`/`ApplicantSession`; `src/server/sms.ts` uses Twilio **Verify** when `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_VERIFY_SERVICE_SID` are set, else a dev-OTP path (code shown only in demo, never logged in prod). Prod has only the Verify Service SID → **dev OTP active (NOT real SMS yet)**. Approved drivers sign in via phone OTP (`/api/v1/driver/otp/*` → staff session).
- **Application** model + states DRAFT→SUBMITTED→IN_REVIEW→APPROVED/CHANGES_REQUESTED/REJECTED + document metadata + event trail (`src/server/applications.ts`). Approval provisions driver+vehicle+binding **atomically, idempotently, off-duty, revision-guarded**; audited.
- **Private storage** `src/server/storage.ts` → Docker volume `taxicy_uploads` at `/app/private-uploads` (env `PRIVATE_UPLOAD_DIR`), outside public/ & Git; magic-byte validation (jpg/png/pdf/heic; rejects exe/HTML/SVG), size limits, sha256; **authenticated streaming only** (applicant own; ADMIN review). `scanStatus=UNAVAILABLE` (no AV scanner — honest).
- **UI**: nav "Staff"→"Login" + "Register as a driver"; `/driver/register` wizard (OTP→identity/driving/vehicle/photos/review, save/resume, camera capture); `/driver/login` OTP; `/admin/applications` queue + detail (doc viewer, per-doc accept/changes, start/request-changes/reject/approve) — **ADMIN only (dispatchers excluded)**.
- Docs: `docs/research/DRIVER-ONBOARDING-REQUIREMENTS.md` (matrix, gov-vs-platform, VERIFY items), `docs/research/EXISTING-DRIVER-MIGRATION.md`.
- **Remaining / blockers**: real SMS needs Account SID + Auth Token (dev OTP until then); AV scanner; expiry reminders + auto DOCUMENTS_EXPIRED (schema ready); legacy-driver review queue to retire LEGACY; email verification; browser QA screenshots (no browser here — server flow live-smoked). Cyprus matrix VERIFY items pending live RTD confirmation.

## Task 013 (2026-09-14) — P0 done, P1 mostly done, P2 partial (code + tests + deploy)
Autonomous-ride correctness + notifications hardening. **vitest 66/66.** Each item's exact status is in Tasks/013's completion matrix (top of file).
- **P0 lifecycle authority**: generic `changeStatus` rejects ARRIVED/IN_PROGRESS/COMPLETED (`USE_LIFECYCLE_ACTION`); shared finalizers in `dispatch/lifecycle.ts` are the only writers; audited staff overrides (`staffMarkArrived/StartTrip/CompleteTrip`, reason + AuditEvent) power the dispatch status route/UI; completion writes exactly one immutable `Fare`, finalizes waiting, releases capacity atomically (upfront→finalCents=accepted, regulated→null).
- **P0 concurrency**: `acceptOffer/rejectOffer/expireOffer` lock the booking row FIRST and re-read the offer under it (single serialization point); GPS-loss rematch verifies exact assignment id+driver and re-checks GPS under lock; per-job try/catch isolates failures. `tests/lifecycle-guards.db.test.ts` (accept-vs-reject/expire/cancel, two-worker single-offer, bypass rejection).
- **P1 ETA**: live pickup ETA passes `departureTime=now` (traffic-aware); ETA cache keyed by booking+driver with eviction (no stale ETA after rematch); approximate fallback labelled "(approx)"; `fetchJsonWithStatus` now times out body parsing too.
- **P1 notifications**: SSRF-safe `saveSubscription` (`isSafePushEndpoint`: https-only, rejects IP-literals/loopback/private/metadata; key validation; per-audience cap 10); notifications for offer/assignment/arrival/no-driver/rematch/cancellation + chat; `NotifyToggle` opt-in on driver duty card + passenger tracking. `tests/push.test.ts`.
- **P1 quote — DONE**: scheduled rides are priced (day/night/holiday) AND routed (traffic-aware future departureTime) for their journey time via `pricingAt`, while quote expiry stays relative to issuance; the quote hash binds scheduled time + luggage + quoteId; Quote persists `pricingAt`+`routeSource` (migration `20260914100140_quote_pricing_at`). "Confirmed by dispatcher" wording removed. Tests in `tests/pricing.db.test.ts`.
- **P2 chat — DONE**: stable (createdAt,id) cursor pagination — latest page + `before` (load older) + `after` (incremental tail) with merge-by-id (identical-timestamp ties handled). ChatPanel polls the tail incrementally, has "Load earlier messages", and remounts on booking change. Tests in `tests/chat.db.test.ts`.
- **Live server-side smoke (2026-09-14) — PASSED.** Created a dedicated synthetic driver (`qa-driver`, bcrypt via a local hash + SQL insert; NOT a real account, NOT a password reset) and drove the full journey against prod release f76e9a6 via the real API: book(COMFORT) → worker offer (real Google ETA, offered in ~1s) → accept → EN_ROUTE → arrive (150m proximity + fresh-GPS gate) → start(code 7279) → complete. Persisted evidence: event trail CREATED→OFFERED→OFFER_ACCEPTED→STATUS_EN_ROUTE→ARRIVED→TRIP_STARTED→COMPLETED; exactly one immutable Fare (REGULATED_METER_ESTIMATE, finalCents null, CASH_TO_DRIVER/PENDING); capacity freed; waiting finalized. Driver GPS was DB test-scaffolding (no physical device), so this proves the dispatch/lifecycle/receipt server flow live, NOT on-device GPS accuracy or handset push delivery. All test bookings cleaned up and the `qa-driver` account was REMOVED afterward (login now 401).
- **Still not run**: a real on-phone browser journey (device GPS + actual push delivery) and multi-tab/desktop+mobile UI regression. To do it, recreate a synthetic driver the same way (do NOT reset real driver passwords) and run on a phone.

## Task 012 M4 (2026-09-13) — mostly DONE (code + tests + deploy)
Release **96abdd2**. Dynamic pricing, weather adapter, Places (New) autocomplete, isolated load test.
- **UPFRONT_DYNAMIC** synthetic pricing (`src/lib/pricing-dynamic.ts`, `src/server/dispatch/market.ts`): bounded [1.0,1.5] deterministic demand/supply multiplier, min-sample threshold, hysteresis, weather-into-demand (capped, non-overlapping), zero-supply→1.0. Applied only to eligible base (initial+distance). **Config-gated** `PRICING_MODE` (default `REGULATED_METER_ESTIMATE` — real charges stay regulated; dynamic is synthetic/TEST). Wired into `createQuote`; upfront = committed price (no ±band).
- **Weather** (`src/server/weather.ts`): timeout + freshness + NEUTRAL fallback; providers `none`(default)/`fixture`/`open-meteo`. Never fabricates weather; open-meteo OFF pending commercial authorization. Env: `WEATHER_PROVIDER`, `WEATHER_MAX_AGE_MINUTES`, `WEATHER_FIXTURE_SEVERITY` (tests).
- **Places (New)**: `googleAutocomplete`/`googlePlaceDetails` (`src/server/google.ts`), `/api/v1/places/{search,details}` with a billing session token + **graceful fallback to forward geocoding** when Places isn't enabled. `PlacesInput` client: session lifecycle, keyboard nav, prediction→details resolution (kept debounce/cancel/stale-guard). **Verified live**: `/places/search?...&session=` returns geocoding (Places API (New) not enabled on the project).
- **Load test** `scripts/load-test.ts` (isolated `_test` DB, Google stubbed): `LOAD_DRIVERS`/`LOAD_BOOKINGS`. Result at 1000 drivers / 100 bookings: 100/100 assigned, ZERO invariant violations, p50/p95 ~4.9s/6.6s (120 drivers: ~1.3s/1.8s). Candidate prefilter scans all drivers — known scaling limit (add a spatial index for production scale).
- **vitest 52/52** (added `tests/pricing.test.ts`, `tests/pricing.db.test.ts`). Migrations unchanged since M3.
- **Remaining M4 (external enablement, not code gaps)**: REGULATED_FIXED airport/zone fixed fares (not implemented); **enable Places API (New)** on the Google project to activate real autocomplete; **authorize a commercial weather provider** to activate real weather. To turn on dynamic pricing for real, set `PRICING_MODE=UPFRONT_DYNAMIC` only once the commercial rule is authorized.

## Production domain il-y.taxi + IL-Y rebrand (2026-09-13) — DONE (server + code + deploy)
Release **8ab7079**. The product is now branded **IL-Y** (visible rebrand only; repo/DB/API/cookies unchanged) on the production domain **il-y.taxi**.
- **nginx**: `/etc/nginx/sites-available/il-y-taxi.conf` (repo copy `deploy/nginx-il-y-taxi.conf`, symlinked in sites-enabled) serves `il-y.taxi` + `www.il-y.taxi` → app on 127.0.0.1:8097, reusing the self-signed origin cert `/etc/nginx/taxicy-ssl/` (works behind Cloudflare "Full"). `cyprustaxi.ackedberryes.store` stays served.
- **App**: `APP_BASE_URL=https://il-y.taxi` + `APP_ALLOWED_HOSTS=il-y.taxi,www.il-y.taxi,cyprustaxi.ackedberryes.store` (in `deploy/.env.production` + wired through docker-compose). Tracking links now derive from the **request host** (allowlisted) — correct on whichever domain the passenger uses. Origin guard already accepts same-host, so no CSRF change needed.
- **Brand**: approved IL-Y kit installed under `public/brand/` and `public/icons/`; `src/components/Brand.tsx` renders the horizontal IL-Y lockup + pin `mark.svg`; favicon/apple-touch/manifest/OpenGraph + all visible "IL-Yas" text → "IL-Y". Source zip `IL-Y-web-assets.zip` gitignored (extracted assets committed).
- **Verified**: forcing the Host to the origin (DNS not live yet), `https://il-y.taxi/` + `www` = 200, `/brand/logo-horizontal-light.svg`, `/icons/favicon.ico`, `/manifest.webmanifest` = 200, `<title>IL-Y — book a ride</title>`; a booking via the il-y.taxi host returns `tracking.url = https://il-y.taxi/track#...`; cyprustaxi still 200. Test booking cleaned up.
- **⚠️ DNS NOT LIVE**: `il-y.taxi` has NO public A/NS record yet (checked 8.8.8.8 + 1.1.1.1). The vhost + app are ready; once you point `il-y.taxi` (and `www`) at 92.39.53.229 it serves immediately. **Confirm whether il-y.taxi will be fronted by Cloudflare** (like the beta) — if so the self-signed origin cert is fine on "Full"; if the origin is exposed directly, issue a real cert (Let's Encrypt/`certbot --nginx -d il-y.taxi -d www.il-y.taxi`, needs DNS pointing here first) or Cloudflare Origin CA.

## Task 012 M2 + M3 (2026-09-13) — DONE (code + tests + deploy)
Release **84c3b1b** live at https://cyprustaxi.ackedberryes.store (verify via /api/v1/health/live `release`; that endpoint also reports `dispatch.alive`).

Autonomous ride-hailing replaces manual-only dispatch (manual assignment kept as an audited admin override).
- **M2** — background dispatch worker (`src/server/dispatch/worker.ts`, started by `src/instrumentation.ts`, DB-backed `DispatchJob`+lease, 2s tick); eligibility + real Google pickup-ETA ranking with 3/7/15km stages (`eligibility.ts`); expiring 20s `DriverOffer` with DB-enforced one-active-per-driver/booking; atomic accept under row lock (`offers.ts`); reject/expire rematch; 180s→NO_DRIVER; passenger retry (`/api/v1/tracking/research`). Driver offer card + passenger SEARCHING/NO_DRIVER UI.
- **M3** — scheduled-ride automation (worker promotes REQUESTED→SEARCHING within a 15-min lead, deadline runs to pickup time); arrival rules (EN_ROUTE→ARRIVED needs fresh GPS ≤150m of pickup, airports exempt) + persisted `WaitingSession` (3-min free grace, pre-pickup paid rate 0 in regulated mode); 4-digit start code (issued at assignment, shown to passenger, driver enters it ARRIVED→IN_PROGRESS); immutable `Fare` receipt at COMPLETED (payment CASH_TO_DRIVER/PENDING, never auto-collected); pre-pickup driver cancel → auto-rematch (fare preserved); prolonged pre-pickup GPS loss (90s) → worker rematch, never for IN_PROGRESS. New driver endpoints `arrive|start|complete|cancel`; driver + passenger UI updated. `src/server/dispatch/lifecycle.ts`. Config tunables in `config.ts` (`config.dispatch.*`, env NAMES: DISPATCH_SCHEDULE_LEAD_MINUTES, DISPATCH_ARRIVAL_RADIUS_METERS, DISPATCH_WAITING_GRACE_SECONDS, DISPATCH_WAITING_RATE_CENTS_PER_MIN, DISPATCH_GPS_LOSS_REMATCH_SECONDS, DISPATCH_WORKER=off to disable).
- Migrations: `20260913153847_dispatch_offers_states` (M2), `20260913160027_m3_waiting_fare_scheduling` (M3). Applied to prod on container start.
- **Tests: vitest 41/41** (`tests/dispatch.db.test.ts`, `tests/lifecycle.db.test.ts` + existing). Test DB: local pg16... actually local **pg12 on :5432**, role `taxi` (needs CREATEDB for `migrate dev` shadow DB), DB `taxi_cyprus_test`; `DATABASE_URL=postgresql://taxi:<pw>@127.0.0.1:5432/taxi_cyprus_test?schema=public DEMO_MODE=true DEMO_PASSWORD=<≥8> npx vitest run`. `vitest.config.ts` runs files sequentially (shared DB).
- **Verified LIVE on prod**: worker ticking; scheduled promotion REQUESTED→SEARCHING with deadline=pickup time + SCHEDULED_PROMOTED event; M2 offer creation with real Google pickup ETA; forced-deadline→NO_DRIVER; all new endpoints present and 401-protected. All live test rows cleaned up.
- **NOT yet done live**: the fully authenticated driver→complete journey (§8.1) on prod — the Sep-11 `beta-access.txt` driver password is STALE (prod rebranded to Ilias/Alex; passwords rotated). The accept→arrive→start→complete→fare chain IS proven by `lifecycle.db.test.ts` against real Postgres. To run it live, obtain current driver creds (or reset one with `npm run bootstrap`-style flow) then walk `/driver/offers`→accept→status EN_ROUTE→arrive→start→complete.
- **Secrets**: a root-owned `Twilio` file (SMS credential) appeared in the repo root this session — added to `.gitignore`, NOT committed. `deploy/.env.production` sets `GOOGLE_MAPS_SERVER_API_KEY` (real Routes/Geocoding in prod).
- **M4 pending**: Places (New) autocomplete (needs Places API enabled), dynamic pricing (synthetic), weather adapter, full acceptance + isolated load tests.

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

## Task 012 (2026-09-13) — M0/M1 done + deployed; M2–M4 staged
Autonomous ride-hailing task. DONE: Cyprus fare research (docs/research/), 4 skills (.claude/skills/),
pricing/quote engine (src/lib/tariff.ts + Quote model + /api/v1/quote + booking fare snapshot),
real Google driver→pickup ETA in trackingView (cached ≤20s), public fleet availability states.
Migration `add_quote_and_fare`. Release 6239837. vitest 27/27.
NEXT (M2, the core): durable auto-dispatch worker — new models (DispatchJob, DriverOffer/Reservation,
booking states SEARCHING/OFFERED/NO_DRIVER), in-process worker with DB job claim, eligibility prefilter +
Google pickup-ETA ranking, 20s expiring offers, atomic accept (reuse assignments.ts SYSTEM actor),
reject/expire/cancel rematch, restart recovery. Then M3 UI (driver offers, passenger SEARCHING/matched)
and M4 (Places New autocomplete, dynamic pricing synthetic, weather, load test). Keep manual dispatch as
the audited admin override.

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
