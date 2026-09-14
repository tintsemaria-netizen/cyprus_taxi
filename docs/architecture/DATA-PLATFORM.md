# IL-Y data platform (Task 016)

PostgreSQL is authoritative for all operations; ClickHouse is an eventually-consistent analytical
projection that is **never** required for order acceptance, dispatch, login, KYC review, or live
tracking. No browser ever holds a database credential or connects to either store.

## Topology

```
Browser/PWA ──HTTPS──> taxicy-app (Next.js, web)
                          │  writes business state + domain events + notification jobs
                          │  ALL IN ONE Postgres transaction (rollback removes them together)
                          ▼
                     taxicy-db (PostgreSQL 16)  ◀── authoritative: bookings, assignments,
                          │                          money/Fare, auth, KYC metadata, GPS latest,
                          │                          DomainEvent + AnalyticsDelivery spool
                          ▼
                     taxicy-worker (same image, WORKER_ROLE=worker)
                          │  dispatch · notifications · analytics export · maintenance
                          │  (one owner; web replicas do NOT run the loop)
                          ▼  at-least-once, leased, batched
                     taxicy-clickhouse (24.8 LTS, private)  ── analytics projection
                          ▲
                     taxicy-app /admin/analytics ── reads via read-only user
```

- **Ownership:** `DEDICATED_WORKERS=true` → only `WORKER_ROLE=worker` runs the loop; the web app
  (`WORKER_ROLE=web`) owns migrations and serves traffic but never ticks the worker. Liveness is
  published to `WorkerHeartbeat` and read cross-process by `/api/v1/health/live`.
- **Private network:** neither Postgres (5432) nor ClickHouse (8123/9000) publishes a host port.

## Atomicity contract

Every domain mutation writes, in the **same** Postgres transaction: the business row(s), a
`BookingEvent` (operational audit), a `DomainEvent` (analytics fact), the `AnalyticsDelivery`
job(s), and any required `NotificationOutbox` job. A rollback removes all of them; a commit
guarantees all of them. `recordEvent`/`enqueue` use `ON CONFLICT DO NOTHING` so a retried mutation
never duplicates and a duplicate never poisons the transaction.

## Event catalogue (`DomainEvent`)

Payloads are **sanitized** — never names, phones, or street text; driver identity is a salted
pseudonym. `aggregateVersion` = booking.revision / offer transition / GPS sequence.

| eventType | aggregate | key payload fields |
|---|---|---|
| `booking.requested` / `booking.scheduled` | booking | vClass, passengerCount, priceType, fareCents, currency, scheduledAt, hasAccount |
| `booking.scheduled_promoted` | booking | status |
| `booking.assigned` | booking | status, driverPseudo, manual? |
| `booking.arrived` / `booking.started` | booking | status, actorType, waitingCents |
| `booking.completed` | booking | driverPseudo, priceType, estimateCents, waitingCents, finalCents, currency |
| `booking.no_driver` | booking | status |
| `booking.rematch` | booking | excludeDriverPseudo, reason |
| `booking.canceled` / `booking.terminated` | booking | actorType, reason |
| `booking.unassigned` / `booking.reassigned` | booking | actorType, reason, driverPseudo |
| `booking.backfill_snapshot` | booking | reconstructed:true (+ snapshot) |
| `offer.created` | offer | bookingId, driverPseudo, etaSec, distanceM, expiresAt |
| `offer.accepted` / `offer.rejected` / `offer.expired` | offer | bookingId, driverPseudo, decision, etaSec, distanceM |
| `fare.recorded` | fare | priceType, currency, estimateCents, waitingCents, finalCents, paymentMethod, paymentStatus |
| `gps.sample` | gps | driverPseudo, gpsSession, sequence, lat, lng, accuracyM, heading, speed, bookingId |

## Metric definitions (`/admin/analytics`)

UTC, half-open `[from, to)` windows. Test/synthetic data excluded by default (toggle to include).

- **Rides requested / completed / canceled / no-driver** — distinct bookings with the respective
  event in the window (event-based, so a booking can appear in more than one).
- **Offer acceptance** = `accepted / (accepted + rejected + expired)` distinct resolved offers.
- **Dispatch latency** = seconds from `booking.requested`→`booking.assigned`, matched per booking
  (p50/p90).
- **Pickup wait** = seconds from `booking.assigned`→`booking.arrived` (p50/p90).
- **Fares** = from `fare.recorded`, grouped by currency: **recorded final only**. A `null` final
  (regulated meter settled with the driver) is counted as **pending**, never zero; **estimates are
  never summed as income**; currencies are never summed together. Payment is to the driver — not
  platform revenue; there is no commission/wallet model.
- **Driver utilization / provider performance** — reported as **unavailable** with a reason (no
  duty-session / provider-call events captured yet), never fake zeros.

Correctness under at-least-once delivery: ClickHouse `domain_events` is `ReplacingMergeTree` with
`eventId` in the sort key, and every query dedups (`count(DISTINCT eventId)` / `argMax` by version),
so a replayed export never changes counts or money — proven **before** any background merge.

## Retention & load

- **Exact GPS** (`GpsSample`): `GPS_RETENTION_DAYS` (default 7). Coordinates are restricted data.
- **DomainEvent**: pruned only when **every** sink delivery is `DELIVERED` and older than a 14-day
  safety window — a still-un-exported event is never discarded.
- **Terminal notifications**: cleaned after 7 days.
- Baseline load note: 1000 drivers at 1 sample/5s = ~200 events/s, ~17.3M/day *if continuously
  online* — an upper bound, not observed usage. Beta fleet is a handful of drivers.

## Dependency failure behavior

- **ClickHouse down/absent:** bookings, dispatch, tracking, KYC, and passenger/driver history all
  keep working. `AnalyticsDelivery` rows accumulate as a durable Postgres spool and drain on
  recovery. `/admin/analytics` shows an explicit *unavailable* state (never fake zeros).
- **Worker down:** `/api/v1/health/live` reports `dispatch.alive=false` from the stale heartbeat;
  web serving is unaffected; state is in Postgres so a restart resumes in-flight dispatch.
- **Analytics exporter dead:** operational health is unaffected (reported separately).

See `BACKUP-RESTORE.md` and `PIPELINE-OPERATIONS.md` for operations.
