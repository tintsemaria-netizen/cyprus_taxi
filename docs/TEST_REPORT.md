# Test report — Taxi Cyprus beta

Date: 2026-09-11. All DB tests run against a real PostgreSQL 16 instance.

## Automated (vitest) — 12/12 passing

Command: `npm test`

- `tests/unit.test.ts` (8): status-machine legal/illegal transitions, terminal immutability, passenger-cancelable states; haversine distance; coordinate validation; point-in-polygon over the Cyprus service area; freshness classification (fresh/stale/disconnected); booking reference shape.
- `tests/booking.db.test.ts` (4): 
  - concurrent same idempotency key + payload → exactly ONE booking row;
  - same key + different payload → 409 conflict;
  - full REQUESTED→ASSIGNED→EN_ROUTE→ARRIVED→IN_PROGRESS→COMPLETED persists; driver freed and no active assignment remains;
  - two concurrent assigns of the same driver → exactly one succeeds (DB `active*` uniqueness), the other 409.

## Manual E2E (curl) — local origin

Booking (idempotent; retry returned same reference) → tracking token exchange → dispatcher login/queue → assign gated by GPS warning then acknowledged → passenger sees assigned vehicle → driver posts real-shaped GPS sample (accepted); duplicate/out-of-order sample rejected (`OUT_OF_ORDER`) → passenger sees `fresh` location → driver drove EN_ROUTE→COMPLETED → after completion passenger location is `None`, driver `available` again, no active assignment.

## Authorization / validation boundaries

| Check | Result |
|---|---|
| guest → `/dispatch/bookings` | 401 UNAUTHENTICATED |
| guest → `/dispatch/drivers-available` | 401 |
| driver → `/admin/drivers` | 403 FORBIDDEN |
| no tracking cookie → `/tracking/booking` | 401 |
| illegal transition REQUESTED→COMPLETED | 409 CONFLICT |
| stale `expectedRevision` | 409 CONFLICT |
| booking outside service area (Paris) | 422 OUT_OF_AREA |

## Public HTTPS smoke (through Cloudflare)

`https://cyprustaxi.ackedberryes.store` → HTTP 200, `server: cloudflare`, our CSP + title. Public booking `CY-RQ9S-UMS2` created; tracking view + dispatcher queue confirmed. Health `ready`.

## Persistence

App container restarted; 3 bookings persisted; DB-backed staff session survived the restart.

## Task 004 corrections — re-verification (2026-09-11)

- **Automated: 17/17 passing** on an isolated `taxi_cyprus_test` DB (name gated; run fails loudly if not `_test`). New regression tests: encrypted-receipt-at-rest (no raw token), `USE_ASSIGN` guard, competing-revisions (one 409 via `SELECT … FOR UPDATE`), failed-reassignment rollback (old assignment/driver/revision preserved), GPS on-duty-pre-assignment accepted / off-duty rejected / older-cross-session rejected.
- **tsc + production build:** pass.
- **Live HTTPS smoke after redeploy:** idempotent retry returns same reference; scheduled booking sent as Europe/Nicosia wall time `11:19` → stored `08:19Z` (UTC+3); too-soon schedule → `SCHEDULE_TOO_SOON`; cross-origin POST → `BAD_ORIGIN`, same-origin login → OK; generic status `ASSIGNED` → `USE_ASSIGN`; full assign → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED.
- **Encrypted at rest:** receipts are `v1:`-prefixed AES-256-GCM; guarded legacy migration re-encrypted the 1 pre-existing plaintext row → 0 plaintext token rows remain. DB backed up first (`deploy/backups/`).

## Tasks 005 + 006 — re-verification (2026-09-11)

- **Automated: 24/24** on an isolated `taxi_cyprus_test` DB. New: DST summer/winter/gap/**fold-with-both-choices**/invalid; receipt encrypt round-trip + legacy plaintext read; GPS within-session reversed-sequence rejection; (existing) reassignment rollback, competing revisions, encrypted-at-rest, atomicity.
- **tsc + production build:** pass (build still skips lint — reported separately, not claimed).
- **Live HTTPS smoke (release `e8463870…` shown at `/api/v1/health/live`):** autumn fold → `SCHEDULE_AMBIGUOUS` with `scheduleOptions:["180","120"]`; fold+offset → resolves (then `SCHEDULE_TOO_FAR`); spring gap → `SCHEDULE_NONEXISTENT`; reverse-geocode returns a fixture only when within ~180 m (else `null` → client shows coordinates); **admin deactivate-while-assigned → CONFLICT**, allowed after completion.
- **Task 006 map picker:** implemented (full-screen selection mode, center-pin draft, browser geolocation + My location + accuracy circle, confirm/cancel/Escape/Back, resize handling, field preservation, async race guards). Page serves 200 with the picker wired in.

### Explicitly UNVERIFIED (no capability on this headless server)
- Real-browser interaction QA at 1440×900 / 390×844 / 360px and **mobile screenshots** (Task 006 asks for these) — no browser/display available; not captured.
- Physical-phone foreground GPS (Android Chrome / iPhone Safari) — no device.
- ~10-minute synthetic load exercise — not run.
These are reported as pending, never as passed.

## Tasks 008 + 009 — re-verification (2026-09-12)

- **Automated: vitest 24/24** (14 unit + 10 DB on an isolated `taxi_cyprus_test` DB) + **Playwright 6/6** (real chromium, in the official Playwright Docker image; this host's OS is too old for local browsers). Details/commands: `docs/BROWSER_QA.md`.
- **Browser checks:** layout no-overflow at 1440/390/360; picker opens full-screen for both fields; form + other stop survive confirm; **coord/address consistency REGRESSION** (a delayed/stale reverse label is never confirmed — coordinate fallback instead); **real Esri tiles load HTTP 200** (zero blocked).
- **Picker-not-loading fix** (root cause: container height 0 → 300px canvas; fixed with `h-full w-full`) — screenshots show the picker rendering the Cyprus basemap.
- **Map provider:** OSM public tiles 403-block apps and Carto now watermarks → switched to **Esri Dark Gray** (no key/watermark). **Referrer-Policy** now `strict-origin-when-cross-origin` on ordinary pages (tile providers get the origin), `no-referrer` on `/track` + `/api` — verified on the live headers.
- **Live deploy (release `2b8b455…`):** headers verified; live picker renders real tiles (`docs/qa-screenshots/live-mobile-picker.png`).
- **tsc + production build:** pass. Lint is still skipped by the build (reported, not claimed).

## Task 010 P0/P1 stability hotfix (2026-09-12)

Confirmed cause of the reported **flicker + endless "resolving…"**: MapLibre's `resize()`
emits `move`/`moveend` with an unchanged centre, and the picker invalidated + re-requested
on every event → an infinite resolve→panel-resize→move→invalidate loop; plus the API helper
had no timeout so a hung reverse fetch left the spinner on forever.

Fixes verified:
- **vitest 24/24** (14 unit + 10 DB on isolated `_test` DB) · **Playwright 10/10** (6 picker + 4 stability).
- New **stability.spec.ts** regressions, run against the **live deployed site** (release `149e821`):
  - **Idle invariant** — 0 reverse calls in 8s after settle (loop gone).
  - **Resize with constant coordinate** — 0 reverse calls from viewport/orientation resize.
  - **Hung request** — 8s client timeout → coordinate fallback; "resolving…" clears.
  - **One settled pan** → a single debounced lookup; exact coordinates kept.
- Reverse-endpoint validation: absent/blank `lat`/`lng` → 422; genuine `0,0` → 200.
- tsc + production build pass.

**NOT done (needs credentials):** the Google Maps Platform migration (Maps JS + Places API New +
Geocoding + Routes) requires a Google Cloud key with billing — not provided. The working
MapLibre+MapTiler map was preserved; reverse/search remain demo fixtures and routing stays
"unavailable" in live mode. Physical-device GPS and load test still pending.

## Not run / pending

- Physical-device GPS on a real phone (needs a device on the HTTPS site) — **unverified**.
- ~10-minute synthetic load exercise (100 driver updates / 100 trackers / 5 dispatchers) — **not run** in this session; report as unverified, not passed.
- Live map/geocoder/router provider integration — not configured (DEMO fixtures in use).
