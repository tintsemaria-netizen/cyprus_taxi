# Taxi Cyprus — complete beta specification and Claude Code execution mandate

Version: 1.0 — 2026-09-10

## 0. Execute this task

You are the implementing engineer for Taxi Cyprus. Deliver a working, tested, deployed web beta, not only a plan, scaffold, screenshots or a frontend with fake backend responses. This document is the standalone source of requirements and supersedes Taxi-Cyprus-Claude-Phase-1.md where details differ. Start implementation immediately after repository inspection. Continue through all milestones without asking permission between routine steps. Record reasonable assumptions and proceed. Never claim an action, deployment or test happened without evidence.

The user authorizes development, testing and a first isolated test deployment. The authorized repository is https://github.com/tintsemaria-netizen/cyprus_taxi (default branch main). Authorized beta host: 92.39.53.229; hostname: cyprustaxi.ackedberryes.store. The user reports that this DNS name points to this server and Claude is installed there. Verify DNS, host identity and current services before deployment. This authorizes deployment of Taxi Cyprus on this specific host, while preserving unrelated services. Server credentials are not included. Discover the intended Taxi Cyprus workspace and its deployment configuration from the accessible environment. Do not use Fugaso, Winzilla, accounting, or any other unrelated application's repository, credentials or production host. If there is no configured target, finish and verify a locally runnable beta with Docker, prepare the deployment assets, and report the exact access needed to publish. Missing deployment access must not stop implementation. Do not purchase resources, overwrite unrelated data or disable permission controls.

## 1. Product decisions and beta boundary

Taxi Cyprus is a taxi service in Cyprus, first delivered as an adaptive web application. Later passenger and driver Android/iOS apps will use the same API. The selected visual direction is dark graphite with lime accents.

Working assumptions, configurable rather than hardcoded:

- One operator-managed fleet; administrator provisions drivers and vehicles.
- Dispatcher manually assigns bookings; no automatic matching.
- Passenger books without creating an account. International phone number is collected but unverified in beta; do not describe it as verified.
- Payment is made to the driver. No online payment or payment-card collection.
- English UI in beta; translation keys prepare Greek and Russian. Show no nonworking language selector.
- Currency EUR. Do not publish invented fares, service hours, company addresses or support numbers. Without configured pricing, display “Fare confirmed by dispatcher”.
- Support immediate requests and scheduled requests. Scheduled bookings are requests awaiting confirmation, not guaranteed reservations.
- All times stored in UTC; display booking and dispatch scheduling in Europe/Nicosia with timezone explicitly identified.
- Service areas are operator-configured polygons. A synthetic Cyprus test area is permitted in demo mode only. Do not imply island-wide coverage without configuration.
- Classes: Comfort (up to 4 passengers) and XL (up to 6), configurable by administrator. Validate actual vehicle capacity.

Included: public service page, booking, secure tracking, cancellation, dispatcher operations, driver interface, foreground GPS, basic admin/settings, installation-ready PWA shell, durable database, API documentation, test data, tests and beta deployment.

Excluded from beta: native apps and app-store submissions, reliable background GPS, independent-driver marketplace, commissions, automatic matching, online payments, ratings, promotions, chat, SMS/WhatsApp integrations, dynamic fares and multi-operator billing. Do not expose inactive controls for these features.

## 2. Visual system and responsive screens

Use the approved dark/lime mockup if present in project assets. If unavailable, implement the following tokens and composition; do not block development waiting for an image.

Tokens: page #111719, panel #1B2226, elevated panel #252D31, border #343D42, accent #C8FF52, text #F5F7F6, secondary text #A4AFB6. Use a modern readable sans-serif, restrained 12–16 px corners, small consistent shadows, crisp line icons. Lime buttons use dark text. No neon glow or decorative gradients. Verify contrast, keyboard focus and touch targets of at least 44 px.

Desktop booking: compact logo/header, navigation to service information and support, approximately 360 px booking column on the left and real interactive map occupying remaining width. Tracking state replaces booking form with trip progress and assigned driver/vehicle details. Do not display a fictitious assigned driver in an unassigned booking.

Mobile: compact header, large map, accessible scrollable bottom sheet for booking or tracking, safe-area padding, visible primary action. Sheet must not obscure map attribution or trapping keyboard focus. When the keyboard opens, focused fields and submit action remain reachable. Avoid mandatory horizontal scrolling from 360 px. Dispatcher on mobile uses list/map tabs instead of a squeezed desktop table.

Required routes:

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Booking-first landing page and service information |
| `/track` | Scoped bearer grant | One booking and assigned vehicle tracking |
| `/privacy` | Public | Operator-supplied privacy information; clear beta placeholder if missing |
| `/terms` | Public | Operator-supplied service terms; clear beta placeholder if missing |
| `/staff/login` | Public login | Staff authentication |
| `/dispatch` | Dispatcher/Admin | Live queue and fleet map |
| `/dispatch/bookings/:id` | Dispatcher/Admin | Booking detail, assignment, timeline |
| `/driver` | Driver | Availability, assigned trip and GPS controls |
| `/admin/drivers` | Admin | Driver accounts and activation |
| `/admin/vehicles` | Admin | Vehicles and current driver binding |
| `/admin/settings` | Admin | Contacts, service area, classes and operational settings |

Public content: concise service description, booking steps, configured coverage, airport-transfer information and configured contact details. Hide absent contact actions; do not invent business claims or ratings. Include loading, empty, validation, API unavailable, map unavailable, permission denied, stale GPS, reconnecting and success states. Use textual status labels alongside color. Passenger pages must not show internal diagnostics or credentials.

## 3. Passenger booking flow

1. Enter pickup/destination through debounced address search or tap map. “Use my location” requests permission only after a tap. Manual map/address entry remains available on denial or timeout.
2. Resolve each stop to latitude/longitude and label. Persist the selected coordinates; editing the text invalidates the prior selection until resolved again. Keep longitude/latitude ordering explicit at map adapter boundaries.
3. Validate both stops against configured service area on server. Show a meaningful unavailable-area response. Prevent identical or practically identical stops using a configurable minimum distance, initially 50 m straight-line, with an explicit error.
4. Select Now or Schedule, vehicle class and passenger count. Collect name, international phone and optional comment. Normalize phone numbers with a maintained parser. Name 1–100 characters; notes at most 1,000; reject oversized input. No HTML rendering of submitted content.
5. Schedule defaults: at least 30 minutes ahead and at most 30 days ahead, configurable. Server clock is authoritative. Resolve Europe/Nicosia DST ambiguity explicitly; reject nonexistent local times and ask which offset for ambiguous times. Immediate requests ignore scheduled fields.
6. Show a review with stops, pickup time, class, passenger count and fare wording. Optional route/ETA estimates must identify estimates and must come from configured routing data. The booking can proceed without an estimate if valid coordinates are available.
7. Submit using a client-generated idempotency key reused for retries of the same payload. Different payload with the same key returns conflict. Disabling the button is supplementary, not the deduplication mechanism.
8. Persist booking and return reference plus secure tracking access. Show “Waiting for dispatcher”. For scheduled rides show “Scheduled request — awaiting dispatcher”. Do not imply a driver is reserved before assignment.
9. After assignment show driver's public display name, assigned car make/model/color, plate, approved contact number, status, GPS freshness and map position only for that assignment. Only show Call driver when a valid contact exists.
10. Show pickup ETA for EN_ROUTE when routable fresh driver GPS exists, otherwise “ETA unavailable”. Destination ETA during IN_PROGRESS is optional; label its meaning distinctly.
11. Passenger can cancel REQUESTED, ASSIGNED, EN_ROUTE and ARRIVED with confirmation; cannot cancel IN_PROGRESS or terminal bookings. A cancellation racing with pickup must be serialized by the server.
12. Refresh/reconnect restores authoritative state. Completion displays trip summary and Book another ride. Do not claim paid unless a separately implemented payment record actually exists; beta does not maintain payment settlement.

Tracking links are bearer credentials, not proof of passenger identity. Use at least 256 bits of cryptographically secure entropy, store only a digest, and scope each to one booking. Prefer `/track#token=...`, exchange fragment through a POST for a booking-scoped secure HttpOnly session, remove fragment from address bar, and never put raw tokens into access logs, analytics, event payloads or referrers. Return a shareable token only on creation/idempotent creation recovery using a bounded encrypted receipt; do not store plaintext grants. Make the initial response recoverable after a lost response without creating a second booking. If using another design, document how the same security and retry properties hold.

Tracking grant lifetime covers scheduled pickup plus 24 hours; after terminal state allow summary access for at most 24 hours, with no further location access. Revocation is immediate. Apply `Referrer-Policy: no-referrer` and `Cache-Control: no-store` to tracking/auth/private API responses. Public booking reference and UUID never authorize tracking.

## 4. Status machine and assignment rules

| Current | Allowed next | Actor |
|---|---|---|
| REQUESTED | ASSIGNED | Dispatcher/Admin through assignment |
| REQUESTED | CANCELED | Passenger-scoped session or Dispatcher/Admin |
| ASSIGNED | EN_ROUTE | Assigned Driver or Dispatcher/Admin |
| ASSIGNED | CANCELED | Passenger-scoped session or Dispatcher/Admin |
| EN_ROUTE | ARRIVED | Assigned Driver or Dispatcher/Admin |
| EN_ROUTE | CANCELED | Passenger-scoped session or Dispatcher/Admin |
| ARRIVED | IN_PROGRESS | Assigned Driver or Dispatcher/Admin |
| ARRIVED | CANCELED | Passenger-scoped session or Dispatcher/Admin |
| IN_PROGRESS | COMPLETED | Assigned Driver or Dispatcher/Admin |

No other progression is allowed. Dispatcher/Admin may cancel IN_PROGRESS only through a separately named exceptional termination action with required reason and full audit trail; passenger and driver cannot. Terminal states are immutable. Administrative correction, if needed, is a separate audit event, never silent history rewriting.

Reassign before IN_PROGRESS only: atomically end old assignment and create new assignment; reset operational status to ASSIGNED; record prior status, actor and reason. Old driver immediately loses read/write and live subscription access. Passenger removes old vehicle location immediately. Explicit unassign before pickup returns the booking to REQUESTED, ends assignment and clears shared location. Repeated commands use idempotency or revision preconditions.

One active assignment per booking, driver and vehicle, enforced in database/transaction logic. For beta, scheduled requests stay in queue until dispatch time; assigning one reserves the driver immediately. Clearly communicate this to dispatcher; do not implement a speculative calendar overlap algorithm. Default “due soon” threshold is 30 minutes, configurable.

Driver must be active, on duty, available, bound to an active suitable vehicle with sufficient seats and no active assignment. Assignment starts despite missing GPS only after dispatcher acknowledges a visible GPS warning. Going unavailable blocks new assignments but does not cancel current trip. Activating/deactivating/binding changes cannot invalidate an active assignment without explicit reassignment or termination. Snapshot relevant vehicle and public driver details on assignment for historical summaries.

Every state mutation commits booking, assignment and audit event together. Use optimistic revision checks or row locks plus database constraints. Race losers receive HTTP 409 and refresh the current state. Authorization is checked again inside the transaction where necessary.

## 5. Dispatcher and administration

Queue: newest immediate unassigned first; scheduled queue ordered by requested pickup ascending; filters for status, class, driver and date; search by booking reference/phone with role protection; pagination. Highlight unassigned immediate requests, scheduled requests due soon and stale GPS without claiming SLA values.

Booking detail: stops, map pins, passenger contact, note, schedule, assignment, event history and only valid next actions. Assignment dialog shows available drivers, vehicle class, GPS freshness and current duty status. Reassignment/unassignment and exceptional termination require reasons. Support conflict responses without losing entered data.

Fleet map: authorized staff see on-duty vehicles with last known locations, freshness, driver and current booking. Off-duty drivers have no active precise location displayed; historical markers are hidden by default. List fallback must work when map provider fails. A booking notification can be in-app; no SMS or external channel is required. Reconnect refreshes full queue.

Admin: create/update/deactivate driver accounts; one-time password setup/reset without displaying stored passwords. Vehicle fields: unique plate, make, model, color, capacity, class, active flag. Bind vehicle to one driver at a time. Prevent deleting records referenced by bookings; deactivate instead. Staff roles are Admin, Dispatcher and Driver. Only Admin manages staff/settings. Bootstrap first admin via a one-time CLI command/environment-controlled setup with no fixed credentials.

Settings: service polygons, timezone fixed to Europe/Nicosia in beta, support information, operating information, classes/capacities, schedule limits, stale threshold, retention and map adapter identifiers. Secrets remain environment/server configuration, never returned in settings APIs. Audit settings and account changes without storing passwords or raw session tokens.

## 6. Driver and GPS

Driver login opens current assignment or an honest empty state. Driver can toggle availability, inspect trip stops/contact, call passenger and open configured external navigation with destination coordinates. No platform navigation integration is required. Status buttons are sequential and large; starting/completing trip requires confirmation. Driver cannot browse other drivers or unrelated trips.

GPS is foreground web geolocation, initiated explicitly while on duty. Clearly display whether sharing is active and explain that switching apps or locking the screen may pause updates. Native driver tracking or hardware integration is future work, not a beta claim.

Use `watchPosition`; coalesce samples and initially send at most once per 5 seconds, plus a stationary heartbeat about every 15 seconds when browser execution permits. GPS sampling and network intervals are configurable. Set request timeout and bounded exponential retry with jitter. Retain only the newest pending location during disconnect, not an unlimited backlog. Upon reconnect obtain a fresh sample. Stop watch and queued transmissions on logout/off-duty; keeping an active trip requires an explicit driver-visible warning before stopping GPS.

Authenticated sample fields: latitude, longitude, accuracyMeters, optional heading/speed, sampledAt UTC and monotonically increasing per-session sequence. Bind identity to authenticated user, never trust driverId in request. Validate finite ranges, nonnegative accuracy/speed, maximum payload and session ownership. Reject timestamps more than 60 seconds in future and samples older than 2 minutes; do not let out-of-order samples replace newer position. Preserve server receivedAt separately. Handle a new GPS session without accepting replayed older samples.

Freshness based on sample age and receive age: fresh <=30 seconds; stale >30 seconds; disconnected >120 seconds, configurable. Poor accuracy >100 m is clearly marked. Thresholds are beta engineering defaults, not guarantees. Freeze stale markers; do not animate invented travel. Modest interpolation between real updates is acceptable only while fresh. No route replay/history is required.

Passenger location feed verifies current booking grant and active assignment on each delivery/fetch. After reassignment, cancellation or completion revoke the old location relationship immediately, including existing streams. Staff subscriptions recheck sessions and driver deactivation. Dispatcher may see latest on-duty fleet samples; passengers never receive fleet-wide data even if UI hides it.

## 7. Architecture and persistence

Inspect repository instructions, dependency lockfiles and deployment environment first. Reuse established conventions if suitable; otherwise default to TypeScript, React/Next.js, a PostgreSQL database and migration-based ORM. Pick compatible supported releases from official documentation at implementation time and pin via lockfile. Keep a single application/service for beta unless infrastructure requires separation. No microservices or Kubernetes required.

Layers: UI → versioned API → booking/assignment/location/auth services → repositories; map/geocoder/router behind adapters. Future mobile clients must reuse business APIs without HTML parsing. Store money, if configured later, as integer minor units plus currency, not floats.

Default updates: authorized bounded polling every 5 seconds for active passenger trip/driver assignment and staff queues, with backoff, visibility handling and complete resync after reconnect. A deployment-compatible SSE transport can replace polling if implemented with the same authorization/revocation and reconnect properties; record decision. Do not require WebSockets solely for a beta badge.

Minimum schema:

| Entity | Core fields / invariants |
|---|---|
| StaffUser | UUID, login unique, passwordHash, role, active, sessionVersion, timestamps |
| Driver | user FK unique, publicName, operational phone, available/onDuty, active |
| Vehicle | UUID, plate unique, make/model/color, class, seats, active |
| DriverVehicleBinding | driver/vehicle FKs, start/end; unique current binding per driver and vehicle |
| Booking | UUID, reference unique, pickup/dropoff coordinates and labels, name, phone, note, class, passengerCount, requestedAt, scheduledAt nullable, status, revision |
| Assignment | booking/driver/vehicle FKs, public snapshots, assignedAt/endedAt, actor/reason; active uniqueness constraints |
| BookingEvent | booking FK, type, actor/scoped passenger actor, before/after, reason, createdAt; append-only |
| LatestDriverLocation | driver unique, position, accuracy, heading/speed, sampledAt, receivedAt, GPS session/sequence |
| TrackingGrant | booking FK, tokenDigest unique, expiry/revocation metadata |
| AuthSession | session digest, user FK, expiry/revocation, creation metadata |
| IdempotencyReceipt | scope/key unique, request hash, encrypted response as necessary, expiresAt |
| Settings/AuditEvent | validated configuration and staff changes |

Index booking status/scheduledAt/createdAt, active assignments, phone search as appropriate, audit booking/time and grants/session lookup. Migrations and seeds must be repeatable; use database transactions and actual uniqueness guarantees for concurrency, not only frontend checks.

Technical retention defaults for isolated beta: no historical GPS route collection; remove latest GPS within 24 hours after duty ends; purge synthetic bookings/contact data after 30 days; retain redacted technical audit for 90 days. Make jobs/config explicit. Real-data retention and public privacy content need operator decisions before a real customer launch; do not label the build legally compliant. Ensure backups follow configured retention and document deletion limitations.

## 8. API contract

Use `/api/v1`, JSON, UTC ISO timestamps and explicit coordinate objects. Generate OpenAPI documentation matching implementation. Pagination max 100, default 25. Error envelope: `{ "error": { "code": "...", "message": "...", "fieldErrors": {}, "requestId": "..." } }`. Return 401 for absent staff auth, 403 for wrong role, 404 for unauthorized/nonexistent scoped booking where enumeration matters, 409 for state/revision conflicts, 422 for validation, 429 with Retry-After for throttling.

| Method / resource | Permission / behavior |
|---|---|
| GET `/public/config` | Safe public service settings only |
| GET `/places/search?q=` | Rate-limited geocoder proxy; bounded query/result length |
| POST `/routes/estimate` | Rate-limited estimate for validated coordinates |
| POST `/bookings` | Public; Idempotency-Key required; 201 durable booking and tracking handoff |
| POST `/tracking/exchange` | Exchange secret for booking-scoped cookie; throttle |
| GET `/tracking/booking` | Scoped summary and permitted current location |
| POST `/tracking/cancel` | Scoped cancellation with expectedRevision |
| POST `/auth/login`, `/auth/logout` | Staff session lifecycle |
| GET `/auth/me` | Current staff identity/role |
| GET `/dispatch/bookings` | Staff filters, pagination and revisions |
| GET `/dispatch/bookings/:id` | Staff detail/timeline |
| POST `/dispatch/bookings/:id/assign` | Staff atomic assignment with expectedRevision |
| POST `/dispatch/bookings/:id/reassign`, `/unassign` | Staff atomic audited changes |
| POST `/dispatch/bookings/:id/status` | Staff allowed transition; reason as required |
| POST `/dispatch/bookings/:id/terminate` | Staff exceptional in-progress cancellation |
| GET `/dispatch/fleet` | Staff on-duty latest positions |
| GET `/driver/current-trip` | Driver current assignment only |
| PATCH `/driver/availability` | Driver availability/duty with trip safeguards |
| POST `/driver/location` | Driver-owned validated foreground GPS |
| POST `/driver/bookings/:id/status` | Current assigned Driver, legal transition/revision |
| CRUD `/admin/drivers`, `/admin/vehicles` | Admin; deactivation rather than historical deletion |
| POST `/admin/vehicle-bindings` | Admin; atomic exclusive binding |
| GET/PATCH `/admin/settings` | Admin; validated non-secret configuration |
| GET `/health/live`, `/health/ready` | Minimal liveness/readiness without sensitive diagnostics |

Add account/reset and audit endpoints as required by implemented flows. Document concrete request/response schemas, limits and examples; this table is not a substitute for working contracts. Tracking, driver and staff representations must be separate serializers to avoid over-sharing private fields.

## 9. Map services and failure modes

Use a real geographic renderer, e.g. MapLibre, with a configurable authorized tile/style provider. Keep attribution visible. Integrate geocoding and routing via separate providers/adapters with timeouts, caching within provider terms, bounded retries and quotas. Never assume free public endpoints allow unrestricted production load. Do not leak private API keys into browser bundles; client keys must have provider-supported origin restrictions.

If credentials are missing, implement explicit DEMO_MODE: fixture places, deterministic routes and an opt-in simulator marked “Simulated vehicle”. Simulated and actual GPS cannot be mixed or silently substituted. Demo seed uses synthetic names/contacts and a conspicuous beta banner. Simulators are inaccessible in live mode and must not submit data into real driver accounts.

Map outage does not erase trip details or prevent status/call actions. Geocoder outage allows map-coordinate selection if map works. If neither stop can be reliably resolved, explain the issue instead of accepting a fabricated address position. Routing outage shows ETA unavailable. Do not show a straight-line route as a road route.

## 10. Security, reliability and observability

Server-side authorization on every read/write; robust password hashing; secure HttpOnly SameSite staff cookies in HTTPS environments; sessions expire/revoke; login rate limits; origin/CSRF protection for cookie-authorized mutations. Separate passenger scoped session and staff session. Logout/deactivation invalidates active access. No default shared admin password.

Validate all payloads on server; parameterized database access; escape user content; appropriate CSP including map dependencies; restricted CORS; no wildcard credential origins. No raw phone numbers, exact GPS, bearer links, passwords or secrets in routine logs. Attach request IDs to structured events and errors. Audit authorized administrative actions without secrets.

Abuse protection must use a shared/database-backed mechanism when replicas are enabled, with correct trusted proxy handling. Use configurable initial limits, e.g. 5 booking submissions/minute per IP and 5 failed logins/minute per account/IP; document NAT tradeoffs and allow tuning. Bound body sizes and expensive geocoder/routing calls. Persistent idempotency receipt TTL at least 24 hours.

Back up PostgreSQL, document restore and verify restore into a separate test DB. Liveness means process alive; readiness verifies essential DB access. Monitor error counts, booking creation failures, assignment conflicts, location freshness and external provider failures. Health responses expose no secrets. Logs have bounded retention.

## 11. PWA and future Android/iOS

Provide web manifest, suitable icons, display standalone, theme colors and installation guidance appropriate to browser capabilities. Offline shell may show connection status and non-sensitive static assets. Never cache private API responses, phone data, tracking pages or staff views for offline reuse. Never queue offline bookings/status mutations in a service worker; require reconnection and confirmation against current state.

Use responsive touch-friendly components now. Keep API auth behind an interface so future mobile clients can use a separately designed revocable token flow. Do not generate unnecessary native projects during beta. Record that native driver background location requires platform-specific implementation, permissions and real-device validation in a later phase.

## 12. Implementation milestones — continue automatically

1. Inspect project, instructions, Git status and available infrastructure. Record assumptions, architecture, implementation checklist and selected stack. Preserve unrelated changes. Establish runnable skeleton and CI basics.
2. Implement PostgreSQL schema/migrations, role auth/bootstrap, validation, status machine, transaction rules and meaningful service tests.
3. Implement responsive public UI, locations, booking persistence, idempotency and secure tracking/recovery.
4. Implement dispatcher queue, fleet map, assignment/reassignment and audit; implement admin CRUD/settings.
5. Implement driver UI, foreground GPS, scoped updates, stale handling, cancellation and full completed trip.
6. Add explicit isolated demo fixtures/simulator, PWA shell, failure/reconnect states and final responsive polish.
7. Run security boundary/concurrency tests, full E2E journey and visual QA; fix failures. Prepare migrations, deployment, rollback, backup and operation docs.
8. Deploy to the configured isolated beta target, run remote smoke tests, capture actual screenshots and deliver release report. If target access is missing, complete all runnable work, provide exact blocker and deployment commands. Never label a local-only build “deployed”.

Commit logical completed units after successful focused checks. Do not force-push or merge unrelated branches. Use a feature branch when repository policy requires it. Do not spend the entire session planning. Scope out enhancements rather than abandoning required beta behavior.

## 13. Context switching, handoff and uninterrupted progress

Maintain these repository files from the first implementation milestone:

- `CLAUDE.md`: stable project conventions, core invariants, validation/start commands and pointer to this spec. Preserve existing instructions; do not overwrite unrelated content.
- `docs/SPEC.md`: this specification.
- `docs/IMPLEMENTATION_STATUS.md`: each requirement/milestone with TODO/IN_PROGRESS/DONE/BLOCKED, evidence and next action.
- `docs/DECISIONS.md`: assumptions, architecture choices and reasons.
- `docs/HANDOFF.md`: current branch/commit, working changes, exact next step, commands, failing tests, open blockers and environment variable names (never values).
- `docs/TEST_REPORT.md`: dated commands/results, real versus simulated checks, remaining failures.
- `docs/BETA_RELEASE.md`: release commit, actual reachable URLs, setup, completed scope and limitations.

Before context compaction, session switch or usage limit: save edited files, record current progress and next runnable command in HANDOFF, update checklist, commit coherent changes where possible and record uncommitted work otherwise. Do not claim automatic account/model/session switching. Use only continuation/compaction features actually supported by the installed Claude Code version; inspect local help before giving version-specific commands. Respect usage limits and permission controls.

After resuming: read CLAUDE.md, SPEC, IMPLEMENTATION_STATUS, DECISIONS and HANDOFF; inspect Git diff/status and running services; continue the next incomplete task. Do not recreate project or redo passed tests without a reason. Never wait for user confirmation after each milestone. Ask only for a concrete unavailable external dependency that cannot be deferred after completing all independent work.

Exact continuation prompt for a fresh Claude session:

> Continue Taxi Cyprus through the beta release. Read CLAUDE.md and docs/SPEC.md, docs/IMPLEMENTATION_STATUS.md, docs/DECISIONS.md and docs/HANDOFF.md. Inspect the current Git state and running services, preserve existing work, and execute the next incomplete milestone. Implement, test, fix and deploy to the configured isolated beta target. Update handoff before context exhaustion. Do not stop at a plan or request approval between routine milestones. Report completion only with actual test evidence and a verified reachable beta URL, or explicitly identify a deployment blocker after finishing the runnable application.

## 14. Acceptance tests and release gate

Required automated tests using a real isolated PostgreSQL instance for transaction behavior:

- Valid immediate and scheduled bookings persist after service restart; server validates time, area, class, capacity and phone.
- Same idempotency key/payload yields the same booking and recoverable tracking handoff; different payload conflicts; concurrent retries create one booking.
- Invalid status edges fail; cancellation/start-trip race has one legal winner; terminal bookings cannot reopen.
- Two dispatchers assigning the same driver/vehicle concurrently cannot create conflicting assignments. Reassignment removes old driver's access including active updates.
- Guest cannot call staff endpoints; driver A cannot read/mutate driver B's trip; tracking grant A cannot read booking B; public IDs give no access.
- Expired/revoked grants and sessions stop access; terminal trips stop sharing GPS; deactivation takes effect.
- GPS rejects invalid/future/out-of-order samples, correctly marks stale/disconnected, handles permission denial and reconnect; no artificial movement after disconnect.
- Service failure responses preserve form data and do not duplicate bookings or expose secrets.

Required E2E: passenger requests → dispatcher sees request → assigns suitable driver → driver sends location → passenger sees assigned vehicle → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED → summary. Also exercise scheduled request, passenger cancellation, reassignment, expired link, offline/reconnect and driver GPS denied. Simulator-based E2E does not count as a physical phone GPS test; label each accurately.

Visual QA: actual screenshots for passenger booking/tracking at 1440×900 and 390×844, dispatcher and driver screens; inspect 360 px width, 768 px tablet, keyboard interaction and safe-area behavior. Check keyboard accessibility, focus, contrast, long addresses and empty/error states. No screenshot substitutes for functioning UI.

Performance beta targets (engineering targets, not measured claims): with 100 driver updates every 5 seconds, 100 active passenger trackers polling every 5 seconds and 5 dispatcher clients, API p95 <500 ms excluding external providers, <1% unexpected request errors, no assignment integrity failures. Run an approximately 10-minute staging load exercise using synthetic data only; record machine configuration, actual load, results and bottlenecks. Never load-test external map providers or unrelated production. If the available environment cannot support this, report it as unverified, not passed.

Beta gate: required journey works end to end with durable DB; no critical authorization/data-integrity defect; successful clean build/migrations; checks reported honestly; mobile UI usable; live versus demo integrations unmistakable; deployment health and smoke checks pass. Physical-device GPS and live maps may be explicitly pending for a demo beta, but must not be represented as verified operational tracking. No silent TODO handlers in included features.

## 15. Deployment and final deliverables

Provide repository source, lockfile, `.env.example` without secrets, database migrations, synthetic seed command, one-time admin bootstrap, Dockerfile and Compose (app + PostgreSQL, reverse proxy if needed), production build/start commands, OpenAPI, README and docs described above.

Configuration examples cover DATABASE_URL, APP_BASE_URL, session secret, tracking receipt encryption secret, DEMO_MODE, maps/style/geocoder/router configuration and provider keys, service area, GPS thresholds and schedule bounds. Explain server-only versus safe client values. Do not place arbitrary environment secrets in frontend-prefixed variables.

Deploy only into identified Taxi Cyprus beta environment; configure HTTPS (required for ordinary remote browser GPS), reverse-proxy headers, non-public DB networking, readiness, restart policy and persistent storage. Apply migrations through an explicit release step. Generate test users securely and deliver access through the approved private mechanism, never public README or logs. Keep demo seeds out of real-data mode. If beta is internet-accessible, display a test-service banner and ensure it cannot be mistaken for an operating taxi business.

Release rollback: record previous image/commit and configuration revision, make a DB backup before destructive schema changes, prefer backward-compatible migrations, document rollback command and data consequences. Do not blindly down-migrate live data. Perform remote health and complete booking smoke test after deployment; a successful build alone is not deployment verification.

Final report must include:

1. Actual beta URL and passenger/dispatcher/driver entry points, or explicit “local beta; deployment blocked” with reason.
2. Release branch and full commit SHA; repository location.
3. What is implemented and what is outside scope.
4. Passed/failed/unrun checks with evidence, screenshots and performance result.
5. Real versus simulated maps, routing, GPS and physical-device validation status.
6. Safe test-account access method and a short reproducible test journey.
7. Setup/deployment/rollback commands and exact outstanding external configuration.

Begin implementation now and continue to this release outcome.


## 16. Confirmed deployment target

Follow tasks/002-DEPLOY-TARGET.md. This confirmed target supersedes earlier notes that a hosting destination is missing. Access availability, DNS and HTTPS still require actual verification.
