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

## Not run / pending

- Physical-device GPS on a real phone (needs a device on the HTTPS site) — **unverified**.
- ~10-minute synthetic load exercise (100 driver updates / 100 trackers / 5 dispatchers) — **not run** in this session; report as unverified, not passed.
- Live map/geocoder/router provider integration — not configured (DEMO fixtures in use).
