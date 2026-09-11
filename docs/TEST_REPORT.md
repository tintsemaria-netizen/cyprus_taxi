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

## Not run / pending

- Physical-device GPS on a real phone (needs a device on the HTTPS site) — **unverified**.
- ~10-minute synthetic load exercise (100 driver updates / 100 trackers / 5 dispatchers) — **not run** in this session; report as unverified, not passed.
- Live map/geocoder/router provider integration — not configured (DEMO fixtures in use).
