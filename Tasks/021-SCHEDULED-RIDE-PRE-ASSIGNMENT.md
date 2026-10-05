# Task 021 — Pre-assignment of scheduled rides (airport transfers)

> STATUS: DONE (code + tests + browser QA + deploy). Implements the 2026-10-01 audit product idea
> "airport pre-assign" within Task 012 §4.4 (never hold a free driver for hours; show "reservation
> received" vs "driver confirmed"; notify if nobody is found by the cutoff).

## Policy (our own; not a claim about any competitor's algorithm)
- **Board, not auto-match.** Drivers see upcoming scheduled rides (next `PREASSIGN_HORIZON_HOURS`=72 h)
  that fit their bound vehicle (class, seats) and **commit** to one. Passenger name/phone are hidden
  until the ride is actually assigned.
- **Limits** under the driver row lock: `PREASSIGN_MAX_PER_DRIVER`=3 live commitments,
  `PREASSIGN_MIN_GAP_MINUTES`=90 between them; no commits inside the conversion window.
- **Free until close.** A commitment never makes the driver busy; within `PREASSIGN_PROTECT_MINUTES`=75
  of it they get no new immediate offers.
- **Conversion.** `PREASSIGN_CONVERT_MINUTES`=30 before pickup the worker (SYSTEM actor) turns it into a
  real Assignment (start code, phones, ASSIGNED) if the driver is active, eligible, on duty and free.
  Otherwise it retries each tick until the scheduled-search lead (`DISPATCH_SCHEDULE_LEAD_MINUTES`=15),
  then **lapses** and the ride goes to normal automatic search in the same tick. Passenger + driver are
  notified. A committed ride is never searched in parallel.
- **Reminder** to the driver `PREASSIGN_REMIND_MINUTES`=60 before pickup (once; fenced update).
- **Release / cancel.** Driver release notifies the passenger; releasing < `PREASSIGN_LATE_RELEASE_MINUTES`=60
  before pickup is recorded as late. Passenger cancel / staff manual assignment end the commitment and
  notify the driver. A released ride can be taken by another driver (commitment history is kept).
- **Flight number** (optional, scheduled airport pickups): validated IATA designator, shown to the
  driver and passenger. **Not live-tracked** — that needs a commercial flight-status provider.

## Implementation
- Schema: `PreAssignment` (history per booking; one live commitment via `activeBookingId @unique`),
  `Booking.flightNumber`. Migration `20261005090000_preassignment_flight`.
- Server: `src/server/dispatch/preassign.ts` (board, claim, release, `runPreassignments`),
  `preassign-core.ts` (`endPreAssignmentTx`, `protectedDriverIds`). Lock order booking → driver.
- Worker: `runPreassignments` before `promoteScheduled`; promotion skips committed rides; eligibility
  excludes protected drivers.
- API: `GET /driver/scheduled`, `POST /driver/scheduled/[id]/claim|release`.
- UI: driver Trips → "Pre-book" (`src/components/driver/ScheduledRides.tsx`); passenger tracking
  "Driver confirmed" card; booking flight field. EN/EL/RU. Dates now always rendered in Europe/Nicosia.

## Evidence
- `tests/preassign.db.test.ts` (11): board privacy, two-driver race (exactly one wins), gap/limit/too-close,
  no parallel search, conversion, busy → retry → lapse → search, offline lapse, single reminder,
  cancel/late release/re-claim, protection from immediate offers. Suite 172 passed / 1 skipped.
- Playwright `tests-e2e/preassign-visual.spec.ts` 3/3 (+ previous 17/17); screenshots
  `docs/qa-screenshots/preassign/`.
