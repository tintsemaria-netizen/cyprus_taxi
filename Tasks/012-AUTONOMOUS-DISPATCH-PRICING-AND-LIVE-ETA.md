> STATUS (2026-09-13): M0 + M1 + M2 DONE, deployed (release f293eef), verified live. M3–M4 STAGED (not yet implemented).
> - DONE M0: 4 project skills (.claude/skills/ilyas-*); market research docs/research/CYPRUS-TAXI-MARKET-AND-FARES.md (verified urban/rural tariff).
> - DONE M1: versioned pricing/quote engine (src/lib/tariff.ts, Quote model, /api/v1/quote) shown before booking + snapshotted on the booking; real Google driver→pickup ETA in trackingView (cached ≤20s); public fleet availability states (available/busy). vitest 27/27.
> - DONE M2: durable auto-dispatch worker (DB-backed DispatchJob + lease, 2s tick, started via instrumentation.ts); eligibility+real-ETA ranking with 3/7/15km radius stages and idle fairness (src/server/dispatch/eligibility.ts); expiring 20s DriverOffers with DB-enforced one-active-per-driver/booking; atomic accept under row lock (src/server/dispatch/offers.ts); reject/expire rematch; 180s → NO_DRIVER; passenger retry (/tracking/research). Driver offer card (countdown + accept/decline) and passenger SEARCHING/NO_DRIVER states. Manual dispatch kept as an audited admin override. /health/live reports worker liveness. vitest 34/34. Verified LIVE on prod: booking→SEARCHING→OFFERED (real Google pickup ETA 360s) and forced-deadline→NO_DRIVER, then test state cleaned.
> - PENDING M3: waiting/finalization rules, scheduled-ride automation (promote REQUESTED→SEARCHING near lead time), complete fleet-state polish. (Driver offer UI + passenger SEARCHING/matched states already delivered in M2.)
> - PENDING M4: Places (New) autocomplete, dynamic pricing (synthetic), weather adapter, full acceptance + isolated load tests.
> These remaining milestones are a large, self-contained build; the live beta still uses manual dispatch for assignment while the pricing/ETA/fleet foundations are live.

# Task 012 — IL-Yas: autonomous dispatch, Cyprus pricing, fleet visibility and real pickup ETA

Prepared: 2026-09-13. Status: READY FOR IMPLEMENTATION, not implemented or deployed by this document.

Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Reviewed baseline: `a66afc90be7afe1656c2a6cb458bbe0c31e4a8e9` on `main`.
Authorized beta target: https://cyprustaxi.ackedberryes.store on `92.39.53.229`.

## 1. Execute this product change

The owner explicitly replaces the manual-dispatch MVP with an automated ride-hailing service. Implement, test and deploy a working beta; do not stop at research, a proposal, a UI prototype or a list of future tasks.

Required outcome:

- A passenger sees all online, on-duty IL-Yas drivers on the map, with clear availability states, then selects pickup, destination and class.
- The system calculates and explains the trip price or regulated fare estimate before confirmation.
- The system selects eligible drivers by actual road pickup ETA, sends expiring offers and completes assignment after driver acceptance. No dispatcher participates in normal operation.
- Rejection, expiry, pre-pickup driver cancellation and no availability are handled automatically.
- Once matched, the passenger sees the assigned driver, vehicle, live position, pickup route and remaining time to arrival. After pickup the interface switches to destination ETA.
- Waiting, fare finalization, cancellations and scheduled orders have explicit, persistent rules.
- Traffic, distance, duration, local time, weather, fleet supply and demand are evaluated where relevant. A factor affecting ETA is not automatically a lawful additional charge.

Preserve the dark graphite/lime IL-Yas design and existing working booking/authentication protections. Keep admin configuration and an audited emergency override, but never make a staff action a dependency of a routine trip. Payment to driver remains supported; adding a payment gateway is not a prerequisite for this beta.

This task supersedes conflicting **product requirements** in CLAUDE.md, SPEC, older tasks and UI text about manual dispatch, dispatcher-confirmed fares and passenger maps showing only an assigned vehicle. Update those documents consistently. Preserve unrelated instructions and access controls. Google Maps remains the chosen provider.

## 2. Repository findings to verify before editing

Fetch current main, inspect local changes and applicable instructions, and record the actual baseline. Do not overwrite another Claude session's work or reintroduce an older local branch.

| Area | Evidence at reviewed baseline | Required change |
|---|---|---|
| Operating model | Root CLAUDE.md specifies manual dispatch/payment to driver | Replace dispatch requirement; preserve payment-to-driver support |
| Assignment | `src/server/assignments.ts` validates candidates and locks rows; assignment requires STAFF action | Reuse transactional rules with SYSTEM actor, durable matching and driver offers |
| Database | Prisma Booking/Assignment have active booking/driver/vehicle uniqueness; no quote/offer/dispatch-job models | Extend constraints to offers/reservations and add durable workflow records |
| Passenger ETA | `src/server/views.ts:trackingView` calls `demoEstimate` for EN_ROUTE pickup ETA | Use real driver-to-pickup Google road routing; retain truthful unavailable state |
| Fare | Tracking response and booking UI contain dispatcher-confirmed fare wording | Add server quotes, consent and final fare records |
| Search | `googleSearch` uses forward Geocoding, not Places API (New) | Finish real autocomplete + selected-place details |
| Routing | `src/server/google.ts` sets traffic-aware routing only when departureTime is supplied | Explicit traffic-aware NOW and scheduled requests; inspect actual callers |
| Fleet | Public feed returns lat/lng/stale for on-duty drivers; no availability field or stable public marker key | Add map states, expiry and identity-minimized marker updates |
| Poll failures | BookingApp keeps old fleet indefinitely after errors | Age and expire markers locally even when no response arrives |
| SDK | `src/lib/google-maps.ts` retains a rejected singleton promise and has no load deadline | Retry must work; bound script and map readiness separately |
| QA | `tests-e2e/geo.spec.ts` was deleted in f0b9efab | Restore meaningful coordinate assertions and failure cases |
| CSP | Task 011 added Google worker sources | Preserve fix; verify deployed headers and actual rendering |

Read `src/server/bookings.ts`, `location.ts`, status-machine, freshness, tracking, auth, rate-limit, schema/migrations, driver page, TrackApp, map components, Docker/deploy files and existing tests. Produce a concise gap table with code references. This task's baseline review was static code review; historical test claims are not new evidence.

## 3. Market research already performed; finish verification before publishing tariffs

### 3.1 Evidence and implications

These are bounded findings from primary sources checked on 2026-09-13, not an exhaustive market census or proof of proprietary algorithms.

| Source | Finding | Implication |
|---|---|---|
| [Visit Cyprus — Transportation](https://www.visitcyprus.com/useful-info/transportation/) | Official tourism guidance describes regulated urban metered and rural taxi categories. Published urban day/night figures: start €3.80/€4.80, km €0.95/€1.10, waiting hour €17/€19; luggage €1.40; specified-holiday supplement €2; five/six passengers +20%/+40%. Day is listed 06:01–20:30, night 20:31–06:00. | Research seed, not automatic production tariff approval. Verify effective rules, inclusions, boundaries and applicability to this operator. |
| [CABCY — Larnaca](https://cab.com.cy/taxi-larnaca/) | Local service advertises licensed drivers, immediate and scheduled rides, official tariffs and an estimate before confirmation. | A usable Cyprus flow can provide automatic booking and transparent estimates without inventing surge. |
| [Bolt — Limassol](https://bolt.eu/en/cities/limassol/) | Bolt publishes a local city service page. | Include Bolt in Cyprus competitor verification; verify other cities/classes separately. |
| [Bolt — dynamic pricing](https://bolt.eu/en-gb/support/articles/115003390333/) | General support describes demand/event/extreme-weather effects and disclosure of increased prices. | International product reference, not evidence that any specific surcharge is permitted in Cyprus. |
| [Uber — marketplace matching](https://www.uber.com/us/en/marketplace/matching/) | Road geometry and traffic mean nearest is not always quickest; short batching can reduce overall pickup waits. | Design ETA-based matching and contention handling; do not claim to reproduce Uber's private algorithm. |
| [Hermes — public transportation](https://www.hermesairports.com/prepare-your-journey/fly-in/public-transportation) | Airport operator describes taxi pickup facilities and points to Road Transport Department guidance. | Airports need verified pickup zones and separate fare-rule research. The linked government guide failed to load in this review: airport price tables remain unverified. |
| [Paphos airport transfer operator — price list](https://www.paphostaxiairport.com/price-list) | Operator publishes destination/vehicle-size transfer offers. | Commercial benchmark only; do not treat advertised transfer prices as statutory taxi rates. |

### 3.2 Claude's required research deliverable

Create `docs/research/CYPRUS-TAXI-MARKET-AND-FARES.md` with a dated comparison covering Bolt, CABCY, urban/rural licensed taxis, airport transfers and at least one independently verified local transfer operator. Use Yandex Go/Uber as UX and dispatch references, not assumed Cyprus operators. Verify availability claims; never infer market coverage or live prices from generic global pages. Do not invent live competitor quotes, market shares, hidden matching weights or acceptance rates.

Research: supported cities/classes; instant vs scheduled pickup; quoted vs final fares; cash/card; waiting/no-show/cancellation; airport pickup; child seats/accessibility; driver acceptance and passenger tracking where publicly documented. Distinguish advertised statements from observed app behavior. If app access is unavailable, mark that explicitly rather than placing real rides.

For pricing, prioritize current Road Transport Department rules and applicable instruments, then official tourism/airport information. Resolve source conflicts by effective date and service category. Verify airport fixed tariffs and inclusions, urban/rural operating rights, tax treatment, holiday calendar and day/night boundary semantics. A web page's crawl date is not a regulation's effective date. Save source links, dates, confidence and unresolved questions beside each parameter.

Assumed initial service scope: configured licensed operating areas in the Republic of Cyprus, EUR, Europe/Nicosia local tariff time. Do not silently treat the whole island bounding rectangle as licensed coverage or mix northern-area rules/currency into this tariff. Model service polygons, airport zones and unsupported crossings/routes explicitly. Leave unsupported regions unavailable with a clear explanation.

Deliver the researched tariff profiles and recommendations, not just links. Unknown rules must not become fabricated facts. Implement a fully testable pricing engine and synthetic beta tariffs even where a real commercial rule is unresolved; isolate that uncertainty to the affected activation, not all development.

## 4. Automatic dispatch and driver acceptance

### 4.1 Persistent workflow

Implement a dedicated background worker with persistent jobs/leases, retry/backoff, expiry and startup recovery. PostgreSQL-backed jobs are an acceptable initial choice; reuse current infrastructure where practical. A client timer, open admin browser or fire-and-forget Next.js request is not a dispatch engine.

Create booking and dispatch work transactionally (outbox/job row). External Maps/network calls occur outside long database locks. The worker rechecks candidate eligibility atomically when offering and accepting. Multiple worker instances and retries must be safe.

Use explicit booking and offer lifecycles. Suggested booking states: SCHEDULED, SEARCHING, ASSIGNED, EN_ROUTE, ARRIVED, IN_PROGRESS, COMPLETED, CANCELED, NO_DRIVER. OFFERED is preferably a separate offer record, not a premature confirmed assignment. Migrate existing REQUESTED and historical statuses without corrupting tracking links or receipts. Record SYSTEM/DRIVER/PASSENGER/ADMIN actors accurately.

### 4.2 Candidate eligibility and ranking

Eligibility requires active driver account, valid approved operating documents as applicable, on-duty status, available/ready state, active vehicle binding, compatible class/capacity and requested equipment, licensed pickup/service area, fresh usable GPS, reachable pickup and no conflicting offer/assignment/reservation. The old manual acknowledgeNoGps escape hatch is not allowed for automated assignment.

Screen spatially first, then compute Google driving ETA for a bounded shortlist. Straight-line distance is only a prefilter, never the final pickup ETA. Use a spatial index/appropriate indexed query; avoid scanning every driver or routing every pair each GPS tick.

Beta policy, configurable and clearly labelled as our own initial engineering choices:

- Process competing requests in a short window up to 2 seconds; prioritize older unserved requests.
- Expand candidate radius in stages such as 3/7/15 km, with zone overrides for rural/airport service.
- Evaluate up to 10 eligible candidates per request initially using traffic-aware road durations.
- Rank primarily by pickup ETA. For candidates within 60 seconds of the best ETA, use longest eligible idle time, then a deterministic tie-break. Track fairness rather than inventing ratings/history for new drivers.
- Exclude candidates above a configurable pickup ETA ceiling (initial test default 20 minutes).
- Offer sequentially to one reserved candidate for 20 seconds. Rejection/expiry releases the reservation and offers to the next eligible driver; avoid repeatedly offering the same request to a driver who declined.
- End the initial search after 180 seconds without acceptance. Show NO_DRIVER with retry/schedule options and no success claim or automatic charge. Retry is an explicit passenger action with a fresh bounded search.

Adjust these defaults if measured beta evidence supports it and document the change. Do not claim they are Yandex/Bolt/Uber settings. If later parallel offers or full batch optimization are added, retain single-winner database guarantees and cancel all losing offers.

### 4.3 Race conditions and recovery

Enforce at most one active trip per booking, driver and vehicle at DB level. Extend exclusivity to pending offers so a driver cannot accept an offer while another booking/admin flow acquires the same capacity. Use consistent lock order, expiring leases, fencing/version checks and bounded deadlock retry. Existing nullable unique active* assignment columns are valuable and must not be weakened.

Driver accept must authenticate ownership, enforce offer expiry using server time and revalidate booking revision, driver readiness and capacity. Accept/reject/cancel/reassign/start/end operations are idempotent. A late acceptance, double tap or old notification cannot resurrect a canceled trip.

Notify the passenger of assignment only after transaction commit; publish through an outbox or equivalent recoverable mechanism. Crash after assignment but before delivery must recover without duplicate assignment. A push notification delivery receipt is not driver acceptance.

Driver rejection/expiry before acceptance automatically retries. Pre-pickup driver cancellation automatically rematches within a new bounded window while preserving the passenger's accepted fare policy. Brief network loss first shows reconnecting; confirmed prolonged pre-pickup loss (initial test grace 90 seconds) expires the assignment generation and rematches. Old driver events must then fail safely. Never automatically reassign an IN_PROGRESS trip because GPS went offline.

### 4.4 Scheduled rides

Store requested pickup time in UTC with Europe/Nicosia input conversion and DST ambiguity handling. Do not reserve an otherwise free driver for hours. Define a configurable dispatch lead time using pickup ETA, acceptance allowance and safety buffer (15 minutes as a beta fallback). Persist scheduled jobs; test restart and clock boundaries. Handle conflicts with upcoming reservations and long current trips. Show reservation received vs driver confirmed distinctly; notify if no driver is found by the cutoff. Quote policy must distinguish immediate price validity from a scheduled fare commitment. No guaranteed availability claim until the required capacity is confirmed.

## 5. Passenger fleet map, tracking and accurate ETA

### 5.1 All drivers and the assigned driver

The owner's requirement is **all active on-duty service drivers on the passenger map**, including busy drivers with a visibly different state. Do not revert to showing only one assigned car or only available cars. Offline/off-duty people are not live fleet; never fabricate them.

Provide viewport loading and clustering for the complete eligible map population, with state legend: available, reserved/busy, location stale. Busy drivers are visible but not matchable. Before assignment omit names, phone numbers, plates, other passengers and trip endpoints. Use short-lived opaque map IDs stable enough for marker updates. Document any spatial precision reduction for unassigned vehicles; this is a display/privacy measure, not an assertion of perfect anonymity. Exact position is needed internally for routing and in the matched passenger's scoped tracking feed.

Validate active staff account, vehicle and binding, not only Driver.active. Do not conflate all visible vehicles with available supply. No public per-driver history or other passenger route data. Pagination/clusters must not silently drop vehicles.

After assignment highlight that car, prevent duplicate overlay markers, show driver's public name, vehicle details/contact, a follow toggle, last location update and the driver-to-pickup path. Other service cars may remain visible. Stop exposing assigned-trip contact/details when the tracking authorization ends, according to existing retention policy.

### 5.2 Three different times

1. Before assignment: estimated pickup range based on fresh eligible supply; if no credible estimate, say searching/unavailable.
2. After assignment: remaining driver-to-pickup road ETA from the latest trustworthy GPS. Never use pickup-to-destination duration here.
3. In trip: passenger-to-destination duration, with pickup-wait countdown replaced by trip progress.

Replace `trackingView`'s demoEstimate. Use Google Routes/Route Matrix with traffic-aware preference for NOW and correct future departure handling for scheduled queries. Reference: [traffic options](https://developers.google.com/maps/documentation/routes/config_trade_offs), [route matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix).

Expose numeric duration seconds, estimated arrival UTC, calculation time, location sampledAt, provider, traffic mode and quality/staleness. Round displayed minutes sensibly; zero ETA is not proof the driver arrived. Arrival is a separate validated event. Show an approximate range/quality message for coarse GPS or degraded routes, never made-up precise traffic.

Initial tunable refresh policy: real GPS sends about every 5 seconds while foreground; publish position deltas independently; recompute active pickup ETA at most once every 20 seconds or on meaningful movement/deviation/state change. Deduplicate shared work across viewers. Cache only as provider terms permit. Age ETA using timestamps between refreshes, then mark unavailable/stale rather than counting indefinitely to zero when data stops.

Handle matrix element errors, invalid routes, quota exhaustion and timeouts individually. Last successful route may be shown as stale with its age; do not replace it with a fabricated road route. Reassignment must invalidate the previous route/ETA/driver atomically from the passenger's perspective.

### 5.3 GPS and map stability

Keep permission prompt and manual pin selection, coarse-location fallback and accuracy circle. Initial geolocation must not overwrite a pin already moved by the passenger. Validate GPS sequence/session, timestamps, impossible jumps, accuracy and freshness. A driver heartbeat without a new position does not make old coordinates fresh. Distinguish connected, GPS acquiring, usable GPS and stale GPS in availability.

Driver web GPS is foreground-only; implement heartbeat expiry and clear UI so a sleeping tab is not treated as a ready driver. Persistent worker and normal foreground passenger/driver flow must work without staff. Do not claim reliable screen-locked background GPS or guaranteed iOS web offer delivery. Document the measured native-driver-app/GPS-tracker requirement separately and preserve API compatibility for Android/iOS. Notifications supplement durable offer retrieval, not replace it.

Implement SSE/WebSocket with authorization and reconnect/version handling, or bounded polling as a measured fallback. After reconnect fetch authoritative state. Client-side fleet aging must continue through failed requests. No marker re-creation flicker on every payload, repeated fitBounds on every location tick, reverse-geocoding loop or unbounded listeners.

Repair SDK load timeout, rejected-promise reset, failed script/callback cleanup, stale generation races and actual Retry on every map surface. Separate SDK readiness from render readiness; show failure/retry if a map never renders. Preserve Task 011 CSP; test a real vector renderer where available, report raster-only coverage honestly.

Finish Places (New) autocomplete and selected-place details, including session lifecycle, minimum field masks, debounce, cancellation, stale-result protection and keyboard interaction. Align API restrictions to browser vs server implementation; no server key in the browser or repository.

## 6. Pricing engine and waiting rules

### 6.1 Separate pricing modes

Implement versioned modes, not a universal multiplier slapped onto every taxi:

- REGULATED_METER_ESTIMATE: quote an estimate/range based on an applicable researched tariff. Final payment follows the authorized metering process; do not advertise a phone GPS calculation as a certified taximeter. Record the actual final meter amount where required, with audit and receipt.
- REGULATED_FIXED: use verified zone/airport fixed fares when applicable, with their actual inclusions and exceptions. Do not add distance, time or surge charges already included in that tariff.
- UPFRONT_DYNAMIC: implement a transparent capped dynamic quote engine, enabled for real service only when that commercial model/rule is established as applicable. Test it in synthetic beta regardless.

Unknown applicability means keep that commercial rule inactive and describe the evidence gap. Continue implementing the automatic beta. Preserve a clearly isolated synthetic/demo mode with no real charges; do not seed invented parameters as official Cyprus law. Activating a commercial tariff is versioned configuration, not an action performed by a dispatcher on each trip.

### 6.2 Factor coverage and non-overlap

| Factor | Required treatment |
|---|---|
| Road distance | Actual valid driving route, not straight-line length; distance unit and rounding explicit |
| Road duration/traffic | Traffic-aware trip duration for estimates; no extra congestion fee if time billing already accounts for it |
| Driver approach | Use for assignment and pickup ETA; never silently bill driver-to-pickup distance |
| Time/night | Correct local tariff boundary and whether it applies at start or by segment, based on verified rule |
| Holiday | Verified Cyprus calendar, including movable holidays and documented surcharge scope |
| Capacity/class | Vehicle capability vs passenger-count rule; no arbitrary XL multiplier over a regulated capacity surcharge |
| Luggage/pets/child seats/accessibility | Ask relevant quantities/capabilities; apply only documented charges, show before booking |
| Airport/zone/intercity/rural | Explicit service rules and tariff precedence; no duplicate included fees |
| Customer waiting | Separate arrival/grace/paid waiting states and transparent timer |
| Traffic standstill vs distance | Model tariff mode switching where required; do not charge a full per-minute ride rate plus full standstill rate for the same interval |
| Supply/demand | Fresh eligible available drivers vs verified active requests within zone/class/window; not all map vehicles or autocomplete activity |
| Weather | Timestamped severity/provider/area for ETA uncertainty and operational warnings; surcharge only in an applicable dynamic mode |
| Season/events | Explainable, configured inputs; avoid double-counting a demand signal as another multiplier |
| Stops/destination changes | New quote/version and passenger consent before payable changes, with meter-mode semantics distinguished |
| Cancellation/no-show | Disclosed, applicable rules and evidence; never charge for system failure/no available driver |
| Taxes/platform fees/discounts/tips | Explicit inclusions and accounting; no assumed tax percentage or mandatory tip |

Implement only valid, sourced commercial parameters; expose unavailable factors honestly. The engine must cover all these cases even if some are zero/inactive in the initial profile.

### 6.3 Quote contract and dynamic algorithm

Server issues a persisted quote bound to normalized pickup/dropoff, class, passenger/equipment/luggage selections, time and rider/session. Store quoteId, currency EUR, price type, subtotal/adjustments/taxes/total or range, rule version, route snapshot, creation/expiry, factor values/ages, reason codes and rounding policy. Use integer cents or Decimal, never binary floating-point billing.

Booking validates quote ownership, payload hash and expiry; client-supplied price or multiplier is not authoritative. Initial immediate quote TTL 120 seconds, configurable. An accepted upfront fare snapshot is immutable: weather, new drivers or tariff edits do not silently reprice a confirmed ride. A route change needs an explicit amendment; ordinary driver rerouting/reassignment must not create a hidden increase. Ensure quote expiry vs booking transaction is race-safe.

For allowed dynamic pricing, implement and document a bounded deterministic function, for example:

`total = rounded(policy minimum/fare components + permitted itemized adjustments)`

`dynamic base = eligible base components * bounded demand multiplier`

Define exactly which components are multiplied. Initial TEST defaults may use zone/class demand-to-supply over a 5-minute window, smoothing, a minimum sample threshold and hysteresis; default multiplier 1.0 for insufficient evidence. A TEST upper bound of 1.5 is a proposed product setting, not a law or competitor fact. No division by zero; zero drivers yields no availability, not an infinite fare. Weather must not be multiplied independently on top of already weather-driven demand without a documented cap/non-overlap policy. No personal/device-based willingness-to-pay pricing. Log input snapshot and reasons so a quote can be reproduced.

Weather adapter must have timeouts, freshness and a neutral fallback. Research a commercially permitted provider, availability, coverage and costs; [Open-Meteo plans](https://open-meteo.com/en/pricing) are one candidate, not an authorization to use its non-commercial endpoint for a commercial service. No invented live weather and no new paid subscription without existing authorization. If credentials are missing, use test fixtures only in tests and leave real weather adjustment neutral/unavailable.

### 6.4 Waiting and finalization

Clearly distinguish passenger waiting for pickup (ETA, not billable by default) from driver waiting after arrival and in-trip chargeable waiting.

ARRIVED requires a driver action plus fresh credible pickup proximity, with an explicit airport meeting-zone exception. Do not auto-charge solely because a marker entered a circle. Establish server arrival time and passenger notification state. Define a documented grace period; TEST example 3 minutes. Where arrival-notification delivery is not established, do not silently begin a new pickup penalty. The official summary does not establish every pre-boarding app waiting rule: verify that separately and keep unverified pickup penalties zero for real regulated mode.

Start paid waiting only under an applicable disclosed policy; show remaining free time, paid seconds, rate and accrued amount to both parties. Persist timestamps so refresh/restart cannot reset or duplicate waiting. A no-show action needs elapsed policy time and arrival evidence. Stop waiting on ride start/cancel; account for authorized intermediate stops separately. Wait counter must not depend on the client's clock or timer.

Use a passenger-visible trip-start code or equivalent robust confirmation to reduce premature starts; return that secret only in authorized views. Completed trip has one immutable fare record/receipt with estimate vs final basis and adjustments. Payment collection status is separate from COMPLETED; do not record cash as collected just because the driver ended the trip. Any correction is an audited adjustment, not silent rewriting.

## 7. Architecture, configuration and operational behavior

Extend the current Next.js/TypeScript/Prisma/PostgreSQL stack. Prefer a small durable worker to an unnecessary microservice rewrite. Add explicit records as needed for Quote/TariffVersion, DispatchJob, DriverOffer/Reservation, availability heartbeat, ETA snapshot, WaitingSession, Fare/Adjustment and outbox events. Document schema/API decisions before migrations, then implement them.

Design quote, create booking, offer list/accept/reject, location/heartbeat, trip events, tracking, public fleet and fare receipt contracts. Include machine-readable state/version/error codes, idempotency and retry semantics. Extend existing APIs compatibly where possible. New driver/tracking/admin endpoints require the correct role and booking/offer scope. Rate-limit quote and public map traffic; protect against fabricated bookings exhausting driver supply. Keep synthetic identities and integrations isolated in tests.

Admin panel manages tariffs with effective dates/preview/history, service zones, matching settings, driver eligibility and operational diagnostics. It is optional during trips. Emergency override uses the same reservation and assignment constraints and records reason/actor. Production-quality operation still needs support for exceptions; autonomous normal operation must not be described as having no support responsibility.

API budgets: report route-matrix elements, ETA refresh calls, autocomplete sessions and weather usage separately. Respect current provider caching/retention rules and quota limits; traffic-aware matrix limits vary by preference, so verify rather than hardcode the largest advertised number. Keep unneeded raw provider responses out of permanent logs. Log redacted correlation IDs and meaningful errors, never keys or passenger contact data in public diagnostics.

Metrics: queue delay, offer accept/expire/reject counts, matching success/no-driver, pickup ETA error, stale-GPS proportion, quote/final deviation by price type, reassignments, API errors and worker health. A worker outage must be detectable and visible as degraded ordering, not endless searching.

## 8. Required verification and deployment

Use the current test framework and an isolated DB. Never load-test public Google endpoints or create unwanted real rides. Synthetic drivers belong only in isolated test fixtures. Perform bounded real-provider smoke tests on the beta with the configured keys; redact secrets from traces.

Acceptance tests must include:

1. Full passenger quote → confirm → automatic offer → driver accept → live pickup ETA → ARRIVED → wait → confirmed start → complete → fare receipt with every dispatcher browser closed.
2. Nearest-by-distance driver has a slower road ETA than another; the latter wins under the configured policy.
3. Disabled account, missing binding, inactive vehicle, wrong class/capacity/equipment, restricted zone, busy driver and stale/coarse unusable GPS are excluded from matching.
4. Concurrent bookings compete for one driver/vehicle; at most one offer reservation/active trip wins. Multiple workers, duplicate accept and accept-vs-cancel preserve invariants.
5. Expired offer, driver rejection, pre-pickup cancellation, driver reconnect and old assignment events behave correctly; no automatic reassignment during IN_PROGRESS.
6. Worker crash before/after reservation/assignment/outbox publication recovers safely; no leaked capacity and no stranded normal booking.
7. No eligible drivers reaches a bounded terminal result; retry creates no duplicates and does not charge.
8. Scheduled activation/restart, reservation conflicts, day/night, holiday and Europe/Nicosia DST boundaries.
9. Public map includes both available and busy on-duty vehicles; no other passenger data. Markers age/expire on network failure, update without flicker and remain stable under pan/zoom.
10. Assigned route is driver→pickup; trip route is pickup→destination; both use correctly ordered coordinates. ETA quality/last update/reassignment/offline transitions are correct.
11. SDK failure→Retry→success, hung SDK/readiness timeout, CSP, picker idle zero extra lookups, resize-no-lookup, one-pan-one-lookup and reverse timeout fallback.
12. Geolocation granted centers near mocked coordinates; denied still permits manual selection; precise timeout falls back; late location never overwrites a moved pin.
13. Places session/details, keyboard navigation, aborted/late results and provider failure, with no fake live suggestions.
14. Fare tables: regulated vs fixed vs dynamic precedence; no duplicated time/distance/airport components; cents/rounding; immutable quote snapshot, expiry and tamper/ownership rejection; allowed amendment consent.
15. Waiting arrival/proximity/grace/notification, restart/replay and no-show abuse; no charge for system-caused rematching/no supply.
16. Weather/traffic unavailable, low sample demand, zero supply, stale supply and bounded surge with transparent breakdown.
17. Existing assignment DB invariants, tracking authorization, auth/session behavior, idempotency, cancellation and beta notice remain intact.

Load-test locally/staging with external providers stubbed and production-like indexes. Initial engineering target: 100 concurrent booking submissions and a 1,000-driver fixture; zero invariant violations, complete worker recovery, bounded queue latency, measured p50/p95 and stated hardware. These are test targets, not claims of production capacity. Tune and publish measured limits rather than inventing throughput.

Test mobile Chromium and WebKit where available, desktop, offline/reconnect and a real phone foreground session. Explicitly report screen-lock/background limitations and any real-device checks not run. Mock routing tests prove business logic; they do not prove current Cyprus traffic coverage or live Maps rendering.

Deploy backward-compatible migrations and worker services to the authorized beta target only. Preserve a recoverable database backup and document rollback/migration implications. No destructive seed reset. Run post-deploy checks and one isolated test journey. Correct root CLAUDE.md, SPEC, HANDOFF, status docs and Tasks index so future sessions do not restore manual dispatch. Task 012 is complete only when the automated beta journey works; unresolved commercial activation or provider access must be listed specifically.

## 9. Execution milestones and handoff

- M0: refresh repo analysis, install/load project skills from Appendix A, publish market evidence and product decisions; immediately proceed to development.
- M1: repair map SDK/search/ETA foundations; introduce schema, quotes and tariff engine with isolated tests.
- M2: worker, eligibility/ranking, driver offers and atomic acceptance; prove concurrency/restart recovery.
- M3: passenger/driver UI, complete fleet states, real ETA, waiting/finalization and scheduled automation.
- M4: integrated tests, provider smoke, isolated load test, beta deployment and live evidence.

At each meaningful milestone commit coherent changes and update Tasks/012 and docs/HANDOFF.md with finished/pending work, exact branch/commit, test commands/results, migrations, environment variable NAMES only, and next action. Before context limits write this checkpoint; use only continuation commands supported by the installed Claude Code. Never switch accounts or bypass limits. Missing credentials for one adapter must not halt unrelated implementation.

Final report: release commit, beta URL, demonstrated no-dispatcher journey, matching policy, active pricing mode and source versions, sample itemized quote/wait receipt, ETA provider and freshness behavior, tests actually run, remaining limitations and commercial activation blockers. Do not claim the installed skills add external credentials, tools or professional certification.

## Appendix A — Ready-to-install Claude Code project skills

These are skill definitions prepared for this task, not a claim they are already installed on the server. Materialize the four files below in the repository, preserve any existing unrelated skills, and commit them with this task. Load the relevant skills during implementation. Verify the installed Claude Code supports project skills; if not, read the definitions explicitly as task guidance without changing account/security configuration.

Format reference: [Claude Code skills](https://code.claude.com/docs/en/skills). Project files use `.claude/skills/<name>/SKILL.md`. Skills supply workflows; browser/search/API access still depends on the actual installed tools. Do not install arbitrary third-party agents or execute downloaded setup scripts to obtain these capabilities.

### `.claude/skills/ilyas-cyprus-fares/SKILL.md`

```markdown
---
name: ilyas-cyprus-fares
description: Research Cyprus taxi-market rules and implement versioned IL-Yas fare, quote, waiting and cancellation policies. Use for tariff or pricing changes.
---

Read Task 012 sections 3 and 6, then the current research and tariff configuration.
Prefer Road Transport Department instruments and dated primary operator sources.
Record jurisdiction, category, effective date, inclusions and uncertainty for each rule.
Keep regulated estimates, regulated fixed fares and authorized dynamic offers separate.
Do not infer Cyprus legality from a global Bolt or Uber page. Unverified parameters may
be synthetic test fixtures, never silently active official tariffs.

Implement server-owned immutable quote snapshots using cents/Decimal and versioned
rules. Explicitly model wait versus drive intervals, tax inclusion, tariff precedence,
quote expiry and accepted amendments. Test double-counting and replay at boundaries.
Produce worked examples with sourced values or clearly marked synthetic values.
Weather and low supply can affect availability/ETA even when surcharge is disabled.
Keep normal pricing automatic; do not send individual fares to a dispatcher.
```

### `.claude/skills/ilyas-auto-dispatch/SKILL.md`

```markdown
---
name: ilyas-auto-dispatch
description: Implement IL-Yas automatic ride matching, expiring driver offers and durable assignment recovery. Use for dispatch, availability or scheduling changes.
---

Read Task 012 section 4 and current assignments, booking state machine and DB schema.
Use road pickup ETA after an indexed spatial prefilter. Filter account/vehicle/binding,
service rights, capacity, fresh GPS and live availability before ranking.
Preserve all three active-assignment uniqueness guarantees and extend them across
pending reservations. Recheck eligibility in acceptance transactions. Use SYSTEM actors.

Run matching in a durable worker with outbox/recovery, server deadlines and fencing.
Never rely on a dispatcher tab or passenger request lifetime. Avoid external API calls
inside long DB locks. Treat notifications as hints; authenticated DB state is authority.
Test acceptance races, expiry, cancellation, multi-worker restart and fairness under
contention. Never reassign an in-progress trip because its GPS disconnects.
Explain our chosen policy without claiming proprietary competitor algorithms.
```

### `.claude/skills/ilyas-maps-and-eta/SKILL.md`

```markdown
---
name: ilyas-maps-and-eta
description: Build and debug IL-Yas Google Maps, Places, fleet visibility, GPS freshness and passenger pickup ETA. Use for location or map flows.
---

Read Task 012 section 5 and current Google adapter, SDK loader, picker and tracking view.
Do not confuse driver-to-pickup ETA with pickup-to-destination travel time. Read current
official Google API guidance for fields, traffic options, limits and allowed storage.
Time-bound SDK and map rendering separately; reset failed loads safely and ignore late
generations. Preserve CSP, idle/no-lookup behavior and user-controlled map position.

Show all active on-duty service vehicles with availability states, not only the matched
car. Only the matching passenger receives assigned-driver contact and exact trip feed.
Keep GPS sampledAt, receivedAt, accuracy and route calculatedAt distinct; age markers and
ETA without needing a successful next response. Never simulate live motion or traffic.
Verify coarse/denied/late geolocation, Places races, route direction and actual rendering.
Document foreground web GPS limits rather than claiming reliable background tracking.
```

### `.claude/skills/ilyas-beta-verification/SKILL.md`

```markdown
---
name: ilyas-beta-verification
description: Verify and deploy the IL-Yas autonomous taxi beta with database race, pricing, browser and recovery evidence. Use for release acceptance.
---

Read Task 012 sections 8 and 9 plus current deployment instructions and handoff.
Prove one full trip with no dispatcher session: quote, automatic offer, accept,
live pickup ETA, arrival/wait, confirmed start, completion and receipt.
Test real DB exclusivity and worker recovery; mocks alone cannot prove locking.
Keep load tests and simulated drivers isolated; stub external providers under load.
Run bounded real-provider checks separately and redact keys/contact data in traces.

Record browser/device, commit, environment, command, result and evidence. Distinguish
unit, integration, headless raster, real vector and real-device checks. Failed/unrun
checks remain visible. Verify deployed worker health and migrations, not just web HTTP.
Save handoff before session limits and deploy only to the authorized IL-Yas beta.
```

## Appendix B — Minimal start instruction

Read this entire Task 012. Install and load its four project skills, inspect current main
and complete the required Cyprus market verification. Then implement, test and deploy
the autonomous IL-Yas beta to the existing target. This instruction replaces manual
dispatch as the normal product model. Do not stop after the plan or research. Preserve
existing work, write checkpoint commits and handoff notes, and report only demonstrated
results and specific unresolved dependencies.
