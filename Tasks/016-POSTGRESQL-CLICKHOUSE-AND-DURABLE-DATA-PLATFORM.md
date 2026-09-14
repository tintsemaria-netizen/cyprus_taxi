# Task 016 — PostgreSQL operational foundation, ClickHouse analytics and durable data pipelines

Project: IL-Y / Cyprus Taxi
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Reviewed baseline: 6d18d162177951e08c4695ebae15b2bc8680fab2, 2026-09-14.

## 0. Outcome and operating instructions

The owner wants a fully database-backed service using PostgreSQL for operations and ClickHouse for analytics. PostgreSQL ALREADY EXISTS. Extend and harden the existing deployment; do not rebuild databases from scratch, replace Prisma or discard current data.

Read applicable repository instructions, current HANDOFF and Tasks 013–015. Reconcile newer commits. Implement this task through migrations, pipeline, analytics UI, tests and the already authorized isolated beta deployment. Preserve incomplete earlier requirements; do not label them complete because this infrastructure exists.

Produce docs/architecture/DATA-PLATFORM.md, schema/DDL, an event catalogue, metric definitions and runbooks alongside working code. No paid service purchase, unrelated server changes, major PostgreSQL upgrade or destructive resets. Use checkpoints and report real blockers only after completing feasible implementation/preparation.

## 1. Verified source observations

- docker-compose.yml has postgres:16-alpine, private service taxi-db, named persistent volume taxicy_pgdata and no public DB port. DATABASE_URL points the app to this database.
- src/lib/db.ts uses PrismaClient; schema already has Passenger, PassengerSession, StaffUser, DriverApplicant, DriverApplication, ApplicationDocument, Driver, Vehicle, DriverVehicleBinding, Booking, Quote, Fare, Assignment, DriverOffer, DispatchJob, BookingEvent, ChatMessage, NotificationOutbox, sessions/grants/settings/audit entities.
- Documents use private file storage /app/private-uploads on taxicy_uploads; PostgreSQL stores metadata. Keep this separation.
- No ClickHouse service, dependency or analytics implementation was found in the inspected tree/package/Compose.
- src/server/location.ts conditionally overwrites LatestDriverLocation; it does not retain accepted GPS history.
- src/server/outbox.ts selects pending notifications without a claim/lease. Retry exhaustion and no-subscriber cases use deliveredAt, obscuring actual delivery outcomes.
- src/server/push.ts helpers enqueue using global prisma, and dispatch/worker.ts invokes some helpers AFTER the business transaction. This is not atomic despite descriptions saying enqueue occurs within domain writes.
- dispatch/worker.ts awaits notification draining inside its dispatch tick. Slow notification delivery can delay offers/deadlines; document expiry runs on every tick throughout minutes divisible by five.
- No backup runbook/scripts were found in the inspected tree. This does not prove server backups are absent: inspect actual deployment safely.

Source review establishes implementation, not current live DB health. Verify server-side database version, migration status, counts by table (no personal data dumps), volume mounts, free space, memory and existing backup jobs before rollout.

## 2. Architecture decisions

Browser/PWA → authenticated backend → PostgreSQL for all authoritative operations.
In the SAME PostgreSQL transaction: business writes + domain event + required notification jobs.
Dedicated workers claim durable jobs; the analytics worker batches domain events → ClickHouse.
Admin analytics backend → ClickHouse with a separate read-only account.
Private uploads → private durable file/object storage; ownership/review/expiry/scan metadata → PostgreSQL.

PostgreSQL is authoritative for bookings, assignment, money/settlement records, auth, KYC decisions and current driver location. Passenger history reads PostgreSQL and works when ClickHouse is down.
ClickHouse is an eventually consistent analytical projection, NEVER required for order acceptance, dispatch ranking, login, document review or live driver tracking.
No browser gets database credentials or connects to either DB directly.
Transient UI draft, map camera and bounded caches can remain client/in-memory state; committed business state and jobs must survive restarts. Do not put every keystroke or map tile into a database.
Secrets remain environment/secret-store data. Business configuration belongs in versioned PostgreSQL records. Binary KYC files do not belong in ClickHouse or SQL blob columns.

## 3. PostgreSQL data model: extend existing entities

Preserve existing ids/FKs and tables. Add typed fields, constraints and indexes incrementally rather than replacing the application model wholesale.

| Area | Authoritative records / required behavior |
|---|---|
| Identity | Existing passenger/staff/applicant identities and secure sessions; ownership checks everywhere; no unsafe merge by unverified phone |
| Driver / vehicle | Approved identity, vehicle/binding, document requirements/expiry, operational availability |
| Booking lifecycle | Booking revision, events, assignments, offers, waiting, quote and fare snapshots; transactional state transitions |
| Finance | Estimate, accepted upfront fare, actual final fare, settlement/payment evidence separated; integer minor units + currency |
| KYC | Application revisions and documents/scan/review metadata; private storage keys; no public scans |
| History | Account-owned completed rides/destinations remain operational PostgreSQL queries; preserve delete/hide history semantics |
| Configuration | Versioned service areas, tariff rules, classes, eligibility/dispatch settings with effective dates and audit |
| GPS | LatestDriverLocation plus bounded durable accepted-sample/event history |
| Reliability | DomainEvent, AnalyticsDelivery/Checkpoint, notification deliveries, worker leases/heartbeats and replay/backfill runs |

Suggested domain event shape:
eventId UUID (stable across retries), eventType, schemaVersion, aggregateType, aggregateId, aggregateVersion, eventOrdinal, occurredAt, recordedAt, environment, correlationId, causationId, sanitized payload JSONB.
Use UNIQUE(aggregateType, aggregateId, aggregateVersion, eventOrdinal) where suitable; allow multiple events within one aggregate revision. Do not invent aggregate order using wall-clock timestamps.

Suggested AnalyticsDelivery:
eventId FK, sink, status PENDING/PROCESSING/RETRY/DELIVERED/DEAD, attempts, nextAttemptAt, leaseOwner, leaseToken, leaseUntil, deliveredAt, redactedLastError; UNIQUE(eventId,sink), indexes on claimable state/time.
Keep domain event immutable; worker delivery state is separate. Notification and analytics consumers have independent progress, retries and capacity. Neither can mark the other consumer's job done.

Enforce FK/unique/check constraints for money range, seats, status enums, document relationships and active assignments where practical. Convert only actively needed free-form JSON/string fields; use schema validation for remaining JSONB.
Review query plans for history by passenger/date, booking queue, expiry lookup, notification claims and fresh eligible-driver geographic prefilter. Avoid full fleet scans per request; use a bounded SQL bounding-box prefilter plus distance/routing, or PostGIS if genuinely needed and deployed safely.
Apply connect/pool/query/lock timeouts appropriate to short transactions. Do not perform SMS, Google, malware scanning, blob upload or ClickHouse requests while holding operational row locks.

## 4. Durable event capture and workers

Capture relevant domain events atomically at their true source:
- booking requested, scheduled/promoted, accepted quote, canceled, no-driver, retry;
- offer created/accepted/rejected/expired, assignment/rematch;
- en-route/arrived/started/completed/terminated, waiting finalization;
- fare/settlement changes;
- driver on-duty/off-duty/eligibility and vehicle changes;
- KYC submitted/review outcome/expiry (metadata only);
- accepted GPS sample;
- provider request outcomes and notification delivery outcomes as separate observable event classes.

Business transaction rollback must remove its events/jobs too. Committed changes must not rely on a fire-and-forget promise to create their event.
Replace notification calls with transaction-aware enqueue at each applicable domain mutation. Dedup by concrete domain event + notification purpose + recipient. Record offerId/assignmentId so delayed jobs cannot describe a different current offer.
Handle duplicate enqueue without poisoning a PostgreSQL transaction: use appropriate ON CONFLICT/skipDuplicates behavior, not catch-and-continue after an SQL uniqueness error inside an aborted transaction.

Run explicit supervised worker process(es)/Compose services with bounded concurrency:
- dispatch deadlines/assignment;
- notifications;
- analytics exporter;
- scheduled expiry/cleanup (may share a scheduler, but jobs must not block dispatch).

Claim rows in short transactions using FOR UPDATE SKIP LOCKED or an equivalent tested atomic pattern; commit the claim, perform external I/O, then acknowledge only with matching lease token.
Reclaim expired leases, heartbeat long work, use backoff+jitter, durable dead-letter states and an admin replay action. Alert on age/depth/failure. Never delete/mark failed jobs as successfully delivered.

Disable old embedded worker startup when the dedicated worker is enabled; document one clear ownership mode and avoid duplicate timers after deployment.
Readiness separates web/operational dependencies from analytics health. A dead analytics worker does not take booking offline. Cross-process health must use meaningful heartbeat/progress, not a module-local timer in the web process.
Preserve notification semantics: accepted by push provider is not proof seen by user. Separate SENT_TO_PROVIDER, NO_SUBSCRIBERS, RETRY, FAILED, EXPIRED/SUPERSEDED; retries may duplicate external delivery so use stable tags/provider idempotency where supported. Do not promise exactly-once external delivery.

## 5. GPS history and telemetry

Keep the existing authenticated monotonic GPS ingestion rules and latest point for live tracking.
When a sample is accepted, persist its durable history/event in the same transaction as the latest-position update; rejected/old samples must not overwrite live state or become accepted travel samples.
Stable sample identity: driverId + gpsSession + sequence (and validation of sampledAt). Record accepted sampledAt, receivedAt, accuracy, speed/heading if actually available, and current assignment context where known.
Publish to ClickHouse asynchronously. Do not wait for ClickHouse in the driver API.
Off-duty location collection remains prohibited; allow only the explicitly safe active-trip exception if the current policy requires it.
Adopt a documented sampling/retention policy; baseline calculation: 1000 drivers at 1 sample/5 seconds = 200 events/sec, 17.28 million/day if continuously online. Do not assume a day-long online fleet is actual usage.
Proposed configurable beta retention: exact GPS 7 days, coarsened geography/aggregates 90 days; document this as a product default pending privacy/operational review, not law.
Size the PostgreSQL spool for outages, partition/clean bounded data when justified, and alert before disk exhaustion. Never silently discard unexported critical lifecycle/finance events. Define deliberate telemetry sampling/backpressure separately, expose any loss and do not claim complete route history if sampled.
Historical routes that were never stored cannot be reconstructed from the current latest point; label their absence honestly.

## 6. ClickHouse projections and correctness

Pin a tested supported ClickHouse version and client dependency after checking official documentation. Private network only, persistent volume, explicit authenticated users: migration/admin, ingestion writer, analytics read-only. No anonymous/default unrestricted access.
Implement versioned SQL migrations and a schema bootstrap command separate from web startup.

Initial analytical tables:
1. domain_events — event-level sanitized facts, eventId unique at query semantics, schemaVersion, environment, type, aggregate/version and UTC timestamps.
2. booking_versions — full analytical snapshot per booking version: class, service zone ids, timestamps/status, quote/fare values, driver pseudonymous id, price type, currency, test flag, deletion marker; no names/phones/street addresses.
3. offer_events — offer/decision timing and actual distance/ETA/source, reason/category and attempt context.
4. driver_state_events — availability/busy/eligibility intervals; enough history to compute online/busy time honestly.
5. gps_samples — restricted pseudonymous driver/session/sample identity, measured coordinates/accuracy, UTC time; TTL and optional coarse zone projection.
6. provider_call_events — provider/action, duration, outcome/error category, correlation id, units if known; no credentials, complete URLs/queries or request bodies.
7. delivery_events — notification purpose/state/attempt latency with stable delivery identity, no chat contents.

Maintain an explicit data catalogue: grain, identity key, partition key, ORDER BY, version semantics, TTL, deletion behavior, owner and source.
Recommended baseline is ReplacingMergeTree with stable sort identity for immutable events/retry copies and versioned booking projections. Partition by an IMMUTABLE event/booking cohort (e.g. original creation month), not mutable status or update time; versions of a booking must converge in the same partition.
For booking snapshots, source versions must order correctly even for fare changes after completion; add a monotonic projection version if Booking.revision alone does not cover every source field.
Use full snapshots or a documented reducer: late delivery of an older version must not overwrite newer state.

Delivery is at-least-once:
- A ClickHouse insert may succeed before the exporter crashes without acknowledging PostgreSQL.
- Retry using the same event identity. A deduplication token is an optimization, not the sole permanent guarantee.
- Define canonical query views using FINAL or explicit event-id/latest-version aggregation as appropriate. Demonstrate correctness BEFORE background merges.
- Never compute sums/counts directly over replayable duplicate raw rows.
- Incremental materialized views do not automatically undo duplicate/corrected input when a source table later merges. For the beta, prefer bounded canonical queries or refreshable/rebuilt rollups over deduplicated facts.
- Avoid routine OPTIMIZE FINAL as a correctness mechanism.
- Batch inserts, configure timeouts and bounded memory; report throughput and sustained backlog drain rate.

## 7. Backfill, reconciliation and retention

Enable reliable new-event capture BEFORE historical backfill.
Use a documented consistent snapshot/chunking strategy and source/projection versions. Backfill must coexist with live updates without replacing newer ClickHouse state with old records.
Do not treat max(auto-increment id) as commit order: a lower-id transaction can commit later. Claim pending delivery rows or use a proven commit-aware checkpoint. Test this race explicitly.
Backfill only data actually present in PostgreSQL. Distinguish reconstructed snapshots from captured historical events; do not invent past GPS/provider latency/driver online intervals.
Backfill/replay jobs must be restartable and idempotent, using keyset pagination and rate limits. Do not load all bookings or documents into RAM.
Reconcile closed intervals and a common covered source set/watermark:
booking counts by status, unique offers, completed rides, monetary totals by currency/price type/known-final status, event/sample counts and latest revisions. Expose pending data and discrepancy causes. Comparing a changing PostgreSQL total with delayed ClickHouse without accounting for lag is not a valid mismatch test.
Do not prune events until each required consumer has acknowledged them and the replay/backup retention policy permits it. ClickHouse needs backups for historical events that PostgreSQL no longer retains.
Account erasure/history hiding and sensitive-data deletion must propagate as appropriate to projections and caches. Pseudonymous identifiers are still restricted data. Keep exact GPS out of general admin charts/exports.
Clearly separate synthetic beta/test data in both stores; default analytics exclude test data and show an explicit test-data toggle.

## 8. Analytics interface and metric definitions

Create ADMIN-only Analytics backed by ClickHouse, with server-side authorization and parameterized queries, bounded ranges/page sizes/query timeouts. Driver/passenger operational history still uses PostgreSQL.
Views: overview, bookings/dispatch, driver utilization, areas, fare/settlement summary, provider performance, data-pipeline health.
Filters: half-open date interval, class, service area, status, test/live. UTC is storage/reporting default; Cyprus-local presentation may be offered only with an explicit timezone label and consistent bucketing across every chart.
Show data-updated time, exporter lag, incomplete interval indicator, backfill coverage and unavailable states instead of fake zeros.

Define:
- Requested/completed/canceled/no-driver rides and denominators/cohorts.
- Offer acceptance: accepted resolved offers / eligible resolved offers, with rejected/expired counts; exclude still-pending appropriately.
- Dispatch latency: request/search attempt start to accepted assignment; differentiate rematch attempts and scheduled lead time.
- Pickup wait: acceptance to arrival (and optionally request to arrival), separate from paid pickup waiting and trip duration.
- Actual versus predicted ETA error only where matching version/time reference and actual timestamps exist.
- Driver online/busy utilization from state intervals intersected with window; missing interval history must be flagged, not filled with invented hours.
- Fare estimate, known final fare and recorded collected payment separately. Sum unknown finalCents as UNKNOWN, not zero. Payment to driver is not platform revenue; no commission/profit dashboard until a real commission/settlement model is implemented and populated.
- Provider usage/error/latency; costs only with a versioned actual rate model or imported bills, otherwise label cost estimates/unavailable.

Add a compact System/Data health panel with DB connectivity, migration version, worker heartbeat, queue depth/age, failed exports, storage thresholds, last backup/restore-check time and reconciliation status. Do not expose DB credentials or public admin metrics endpoints.

## 9. Infrastructure, backup and rollout

Inspect actual host resources and other services first. For beta, a private resource-limited ClickHouse container may share the host if capacity allows; isolate its memory/CPU/I/O so analytics cannot starve PostgreSQL. Describe future separate-host topology without purchasing infrastructure.
Keep existing PostgreSQL data volume and private uploads. No public 5432/8123/9000 exposure. App account should not own unrestricted migration privileges; use least-privilege runtime and separate migration credentials where practical.
Migrations run once through a controlled deployment step; no destructive reset/seed. Use expand/backfill/validate/contract where needed and prepare rollback compatible with preserved events/data.
Implement automated encrypted PostgreSQL backups and private-upload backups to an authorized off-host destination; if no destination credentials exist, complete scripts/local restore verification and report the off-host blocker. Local same-disk snapshots alone are not disaster recovery.
Include PostgreSQL WAL/PITR plan and ClickHouse backup/rebuild procedure. Proposed targets: operational RPO <=15 minutes and RTO <=2 hours; do not claim achieved until a measured restore proves it.
Restore into isolated services, validate FKs/counts/migrations and document readability without exposing real documents. PostgreSQL metadata and file backups must be mutually consistent or include a recovery/reconciliation strategy.
Add volume/disk monitoring and retention schedules; document backlog capacity and failure behavior.
Existing real SMS/scanner blockers and Task 014 visual work remain separate open work; installing analytics must not silently enable demo verification or bypass KYC checks.

## 10. Acceptance tests

Use isolated PostgreSQL AND ClickHouse for integration tests, not only mocks:
1. Business transaction rollback → no event/job. Commit → durable event/job.
2. Crash after PostgreSQL commit, before export; recover.
3. Crash after ClickHouse insert, before acknowledgement; replay does NOT change canonical counts or money.
4. Two exporters/notification workers, lease expiry, delayed old worker acknowledgement, out-of-order revisions.
5. Lower event sequence commits after higher sequence; it is eventually exported.
6. ClickHouse down for a controlled period: bookings/dispatch/history remain operational, backlog visible; recovery drains completely.
7. Poisoned schema event isolated in dead-letter, later records progress and admin replay works.
8. GPS latest point and accepted event atomic; repeated/out-of-order samples; defined telemetry backpressure.
9. Snapshot backfill concurrent with active booking updates and repeated rerun, reconciliation passes.
10. Notification exact offer expiry, retries, duplicate recipients and exhausted attempts correctly classified.
11. Financial nulls/currency/estimate versus settled totals, timezone/DST windows, test-data exclusion.
12. Account authorization/privacy, SQL parameter safety, restricted GPS and KYC exclusion.
13. PostgreSQL+uploads recovery and ClickHouse backup/rebuild check.
14. Task 013–015 operational regressions.

Measure isolated baseline versus changed booking/dispatch latency with analytics off/on/unavailable. Include 100 concurrent booking attempts, two workers and 200 accepted GPS samples/sec sustained for at least 10 minutes if test hardware permits; stub paid providers, never use real passenger accounts or live paid API load. Set and report acceptance thresholds before running; report limitations rather than fabricated pass.
Verify deployed application/worker SHAs, actual database health, private ports and one synthetic event reaching an admin chart. Report local, integration, browser and live checks separately.

## 11. Completion deliverables

- Working PostgreSQL extensions, ClickHouse DDL/client, dedicated workers, bounded backfill/replay/reconciliation and admin Analytics.
- DATA-PLATFORM.md with diagram, table/event/metric catalogue, retention, load assumptions and dependency failure behavior.
- BACKUP-RESTORE.md and PIPELINE-OPERATIONS.md with measured recovery and commands.
- A factual old-task status update plus Task 016 completion matrix.
- Commit/deployed SHAs, migration results, test/load/reconciliation evidence and exact external blockers.

Official implementation references (verify version compatibility):
- PostgreSQL queue locking: https://www.postgresql.org/docs/16/sql-select.html
- ClickHouse ReplacingMergeTree: https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/replacingmergetree
- ClickHouse deduplication: https://clickhouse.com/docs/concepts/features/operations/insert/deduplication
- Incremental materialized views: https://clickhouse.com/docs/concepts/features/materialized-views/incremental-materialized-view
- Materialized view types: https://clickhouse.com/docs/concepts/features/materialized-views

Do not stop after a schema design: implement the verified data path and a usable analytics screen.

