> STATUS (2026-09-14): P0 DONE + deployed; P1 mostly DONE + deployed; P2 partly DONE. vitest 66/66. See completion matrix at the bottom. Remaining (documented next actions): scheduled-time quote pricing (pricingAt/departureAt), full ETA source-exposure in the passenger UI, full chat cursor pagination, and the authenticated live browser journey (blocked on current synthetic-driver creds — see HANDOFF).
>
> Completion matrix:
> - P0 authoritative lifecycle — DONE. changeStatus rejects ARRIVED/IN_PROGRESS/COMPLETED (USE_LIFECYCLE_ACTION); shared finalizers are the only writers; audited staff overrides (reason + AuditEvent); completion writes exactly one immutable Fare + finalizes waiting + releases capacity atomically; upfront→finalCents=accepted, regulated→null.
> - P0 serialized offer decisions — DONE. accept/reject/expire lock the booking row first + re-read under lock (one winner); GPS-loss rematch verifies exact assignment id+driver and re-checks GPS under lock; per-job try/catch isolates failures. Deterministic concurrency tests in tests/lifecycle-guards.db.test.ts.
> - P1 quote timing — PARTIAL. Idempotency hash now binds luggageCount + quoteId; dispatcher-confirmed wording removed; upfront vs regulated settlement semantics fixed in completion. REMAINING: separate quoteCreatedAt/expiry from pricingAt/departureAt for scheduled trips (day/night/holiday at journey time) + bind schedule into the quote hash.
> - P1 traffic-aware ETA — MOSTLY DONE. Live pickup ETA now passes departureTime=now (genuinely traffic-aware); cache keyed by booking+driver with size eviction (no stale ETA after rematch); approximate fallback labelled "(approx)"; fetch timeout now covers body parsing. REMAINING: surface source/generatedAt in the passenger UI beyond the "(approx)" hint; audit dispatch-ranking traffic preference.
> - P1 notifications + subscription safety — DONE. SSRF-safe saveSubscription (https-only, no IP-literals/loopback/private/metadata; key validation; per-audience cap); notifications for offer/assignment/arrival/no-driver/rematch/cancellation + chat; opt-in on driver duty card + passenger tracking via NotifyToggle. REMAINING: atomic outbox delivery (currently best-effort fire-and-forget).
> - P2 chat continuity — PARTIAL. listMessages returns the LATEST 200 (newest never vanish); ChatPanel remounts (key) on booking change to reset state; ownership enforced. REMAINING: full timestamp+id cursor pagination for very long threads.

# Task 013 — Close autonomous ride lifecycle gaps and verify the release

Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Reviewed baseline: 4a143ec62a90e58538068c1aad6a3d54616473e7 (2026-09-13).
Product: IL-Y. Continue Task 012; do not rebuild the product or replace Google Maps.

## Objective and execution

Make the existing autonomous booking → offer → acceptance → pickup → trip → completion flow correct under concurrent requests, outages and retries. Add operational ride notifications using the existing push foundation. Execute implementation, tests and deployment to the already authorized isolated beta target. Do not stop after a plan.

Read CLAUDE.md, applicable AGENTS.md, Tasks/012, existing project skills, docs/HANDOFF.md and the current code. Fetch the latest main and reconcile changes after this review before editing. Reproduce each issue with focused tests. Preserve unrelated work and working map stability, branding, all-on-duty-driver visibility and admin tools. Normal rides must never require a dispatcher. Do not create a new production domain, purchase services, rotate existing credentials or change real tariff policy to complete this task.

Work in checkpoints; update HANDOFF after each. Keep implementation documentation consistent. No secrets, tracking credentials, phone numbers or push subscription tokens in reports.

## Current repository state (source review, not independently executed tests)

Task 012 introduced durable dispatch jobs, 20-second offers, GPS-based rematching, scheduled promotion, waiting sessions, start codes, quote snapshots and receipt records. Recent commits added live route rendering, marker animation, booking chat and Web Push.

The latest commit reports Vitest 56/56; HANDOFF reports an older isolated 100-booking/1000-driver load run with Google stubbed, and explicitly says the full authenticated autonomous journey was not run live at that checkpoint. Do not treat those reports as verification of the latest release. IMPLEMENTATION_STATUS is still dated September 11. HANDOFF's domain/Places enablement statements also require current verification.

## P0 — One authoritative lifecycle; close the legacy status bypass

Evidence:
- src/app/api/v1/driver/bookings/[id]/status/route.ts calls changeStatus.
- src/server/assignments.ts changeStatus permits transitions using src/lib/status-machine.ts.
- The generic path allows EN_ROUTE → ARRIVED without arrival GPS validation, ARRIVED → IN_PROGRESS without the start code, and IN_PROGRESS → COMPLETED without the Fare creation in dispatch/lifecycle.ts.

Requirements:
1. Route lifecycle mutations through one domain implementation. Generic status endpoints must reject protected transitions with a clear error or invoke the same validated services with all required inputs.
2. Preserve the driver's ASSIGNED → EN_ROUTE action. Apply the same invariant rules to staff routes; an exceptional override must have an explicit authorized action, reason and audit, never an accidental bypass.
3. Completion must always finalize waiting as appropriate, write exactly one valid receipt/settlement state, close the assignment and release capacity atomically.
4. Make retries deterministic. A successful action whose response was lost must not create duplicate events, fees or assignments.
5. Review cancellation, manual assignment/unassignment, NO_DRIVER retry and termination for cleanup of offers/jobs/waiting and correct capacity release.

Acceptance: direct HTTP tests prove that legacy routes cannot bypass GPS, start-code or receipt rules; valid normal and explicit admin paths still work.

## P0 — Serialize offer decisions and protect rematching from stale observations

Evidence:
- offers.ts acceptOffer reads offer status/expiry BEFORE locking Booking and does not re-read them after acquiring that lock.
- rejectOffer and expireOffer read then update without a common lock or conditional status update. A concurrent accept can therefore race with rejection/expiry.
- worker.ts rematchOnGpsLoss captures driver/assignment information outside the transaction; inside the booking lock it rechecks booking status but not assignment identity or the current GPS fix. rematchBooking then ends whichever assignment is current.

Requirements:
1. Define one consistent lock order for booking, offer and capacity entities. Use locked revalidation and/or conditional updates so exactly one of accept/reject/expire/cancel wins.
2. Revalidate server-time expiry, offer status, booking state, active assignment, driver availability, binding, vehicle and current GPS eligibility at the point of acceptance.
3. Prevent stale workers from mutating a replacement assignment: compare the exact assignment id/version and driver under lock and recheck fresh GPS.
4. Enforce one active booking per driver/vehicle, one active offer per booking/driver, and no live offers/jobs on terminal bookings. Check cross-table offer-versus-assignment races with manual overrides.
5. Keep external Google calls outside DB locks. Check the 10-second job lease against provider latency and candidate evaluation; add lease renewal/fencing or an equivalent safe design.
6. Bound each job's work and isolate per-job failure so a single slow/erroring route lookup does not stop deadline handling for the queue.

Acceptance: deterministic concurrent DB tests for accept-versus-reject, accept-versus-expire, accept blocked across expiry, passenger cancel-versus-accept, two workers, worker restart, and old GPS rematch-versus-new assignment. Assert states and events, not merely HTTP responses.

## P1 — Correct quote timing, accepted-price binding and settlement semantics

Evidence:
- quote.ts QuoteInput/hash and /api/v1/quote schema have no requested pickup time.
- createQuote uses now for tariff evaluation; quote expiry also derives from that parameter.
- bookings.ts accepts an optional quote and its idempotency hash omits quoteId and luggageCount.
- completeTrip writes finalCents=null and a regulated-meter note for every price type, including UPFRONT_DYNAMIC.
- createQuote can produce an upfront price from a straight-line fallback when Google fails.

Requirements:
1. Separate quoteCreatedAt/expiry from pricingAt/departureAt. Normalize scheduled pickup to UTC using Europe/Nicosia rules; use the intended journey time for applicable day/night/holiday rules and routing.
2. Bind the accepted quote to all relevant booking inputs, including schedule and luggage. Changing any price-bearing field must invalidate the quote. Preserve retry recovery for the exact original booking even after quote expiration.
3. Define and enforce when a quote is required for a fare-bearing booking. Never silently dispatch a normal priced booking without an accepted quote. Keep any intentional legacy path explicit and tested.
4. Persist route source, precision/fallback status, applicable rule version and accepted breakdown. Keep raw metres/seconds for calculation; round only for display.
5. In a permitted upfront mode, completion must preserve the accepted amount plus only explicitly agreed, rule-authorized adjustments. A fallback approximate distance must not silently become a guaranteed real fare.
6. For regulated estimates, do not fabricate a final metered amount or pretend payment occurred. Present estimate/settlement pending honestly; if implementing actual meter submission, make it validated, auditable and separate from immutable accepted-price evidence.
7. Keep dynamic pricing synthetic/test-only until an applicable commercial policy is authorized. Do not enable weather charges or fixed airport rates by inventing rules. Carry forward genuine external blockers from Task 012.
8. Remove the remaining "Fare confirmed by dispatcher" contract/text in views.ts and elsewhere. Explain estimate versus fixed agreed price plainly.

Acceptance: quote issued daytime for a scheduled nighttime trip; holiday and DST boundaries; expiration remains relative to issuance; changed schedule/luggage/quote with same idempotency key; exact retry; route failure; meter estimate completion; synthetic upfront completion; repeated completion.

## P1 — Real traffic-aware ETA with truthful fallback and bounded cost

Evidence:
- google.ts adds TRAFFIC_AWARE only when departureTime is passed.
- views.ts calls googleRoute without it although its comment claims traffic awareness.
- pickup ETA cache is keyed only by booking id, not assignment, and has no eviction.
- views.ts fallback uses demoEstimate with the same approximate display format as a Google result.

Requirements:
1. Audit every caller: dispatch ranking, booking quote, driver navigation and passenger tracking. Select appropriate routing preference/departure time explicitly using current Google official documentation.
2. Expose source, generatedAt and freshness for ETA; distinguish road estimate, traffic-aware estimate and approximate fallback. Never use fake precision or say live traffic if the request does not use it.
3. Invalidate ETA and route cache on assignment/target/status changes. Bound caches with eviction and coalesce concurrent requests.
4. Check duplicate passenger/driver polling, stationary updates and multiple tabs; bound paid provider calls without losing meaningful rerouting. Handle body-read timeouts too: fetchWithTimeout currently clears its timer before response JSON parsing.
5. Continue showing fresh/stale/busy vehicle states and the assigned car. On disconnect stop presenting old coordinates/ETA as live. Preserve the user's requirement to see all on-duty drivers, including busy cars distinguished visually.

Acceptance: new driver after rematch immediately gets the correct route/ETA; traffic preference request tests; quota/timeout fallbacks; stationary and multi-tab provider-call budgets; no map flicker or camera refitting on every GPS sample.

## P1 — Ride notifications and push subscription safety

Evidence:
- push.ts only implements notifyNewMessage; offer creation does not notify the driver.
- subscribe control is inside ChatPanel, which is reached after assignment; drivers need opt-in before their first offer.
- saveSubscription accepts arbitrary endpoint/key strings and endpoint upsert overwrites its audience.
- ChatPanel reports notifications on based on browser permission alone, without verifying the subscription for the current audience.

Requirements:
1. Provide notification opt-in on the driver's idle/on-duty screen and passenger tracking screen.
2. Add notifications for new offer, assignment, arrival, rematch, no-driver and cancellation; keep chat notifications. Delivery supplements authoritative server state and polling.
3. Persist notification events atomically with domain transitions (outbox or equivalent), dispatch outside transaction with bounded retries, expiry and deduplication. Never deliver an expired offer as actionable.
4. Validate subscription payload sizes/types, HTTPS endpoint and approved push-provider destinations; block loopback/private/link-local/metadata destinations and unsafe redirects. Add request and audience subscription limits.
5. Model device subscriptions and audience bindings deliberately. Do not silently overwrite another ride/account binding. Support revocation/logout/expired grants and cleanup without disabling unrelated authorized bindings.
6. A notification click must recover the correct authorized ride; no tracking bearer token or sensitive chat contents in notification URLs/logs. Re-fetch state before presenting actions.
7. Show permission versus active server subscription accurately. Preserve in-app behavior on denied/unsupported push.
8. Verify browser/PWA support from official sources. Do not claim Web Push makes foreground browser GPS work continuously in the background or makes the driver reachable when the OS suspends the app. Document physical-device checks separately.

Acceptance: idle driver receives an offer notification; delayed/duplicate/outdated delivery; reassign/cancel; revoked permission; logged-out device; multiple rides in one browser; invalid/private subscription destination rejected before outbound network activity. Use mocked providers for automated tests, own test devices only for live delivery.

## P2 — Chat continuity and authorization

Evidence:
- chat.ts lists the earliest 200 messages; ChatPanel replaces messages on each poll and does not request a cursor. After 200 messages, new messages are omitted/vanish.
- driver ownership check occurs outside the message write transaction.
- ChatPanel retains local conversation state when its endpoint changes.

Requirements:
1. Stable cursor pagination using timestamp plus unique id, bounded latest-page loading and merge-by-id. Do not lose messages sharing a timestamp.
2. Reset conversation, drafts, unread state and pending requests when the booking/assignment changes; ignore responses from the old conversation.
3. Enforce active driver ownership and allowed booking status atomically when sending. Snapshot the intended recipient/assignment for notification delivery.
4. Handle stale overlapping polls and send-versus-refresh races. Define whether a replacement driver can see previous assignment messages and make the UI/authorization follow that explicit policy.

Acceptance: 205+ messages, identical timestamps, lost-response retry, delayed poll, rematch while sending, old driver access denial and switch between trips.

## Verification, deployment and completion evidence

Run existing unit/DB tests, add the focused regressions above, and run a browser full journey with separate passenger and driver sessions:
quote → book → worker offer → accept → EN_ROUTE → arrival → code → start → complete → receipt.
Also test rejection/reoffer, cancellation, no-driver retry, scheduled promotion and GPS-loss rematch. Test desktop and mobile viewports and preserve map stability regression coverage.

Use an isolated test DB and provider stubs for concurrency/load. Never load-test paid Google endpoints or real passenger/driver accounts. Re-run a representative queue workload including provider delay/failure and report throughput, p50/p95, invariant failures, job deadline behavior and provider call counts. Do not present a stubbed load run as live Google capacity proof.

Use dedicated synthetic beta accounts for an authorized live functional smoke; do not reset real driver passwords. If live access is unavailable, complete code/testing/deployment preparation and explicitly state that one remaining blocker. Never falsely claim live completion.

Verify actual public host, TLS, Maps key domain restrictions, service worker scope, CSP and /health release before declaring deployment done. HANDOFF contains older il-y.taxi DNS notes: treat them as historical observations. Existing beta deployment authorization applies; preserve unrelated services.

Places (New) uses the SERVER key in google.ts. Diagnose project enablement AND that key's API restrictions, not just browser-key permissions. Keep the key server-only and do not weaken IP restrictions. Verify live predictions/details or report geocoding fallback honestly.

Deliver:
- Implemented fixes, commit and deployed application SHA.
- Test commands/results separated into mocked, local DB, browser and actual live checks.
- Screenshots for driver offer, passenger tracking, arrival/start, completed fare and notification setup.
- Short Task 012/013 completion matrix; clearly mark external tariff/weather/Places/device blockers.
- Updated Tasks/README.md, HANDOFF, IMPLEMENTATION_STATUS and release/test report.
- Remaining risks and exact next actions. A passing unit suite alone is not completion.

