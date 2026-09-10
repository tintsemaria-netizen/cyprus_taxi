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

## Not run / pending

- Physical-device GPS on a real phone (needs a device on the HTTPS site) — **unverified**.
- ~10-minute synthetic load exercise (100 driver updates / 100 trackers / 5 dispatchers) — **not run** in this session; report as unverified, not passed.
- Live map/geocoder/router provider integration — not configured (DEMO fixtures in use).
