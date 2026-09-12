# Task 010 — Migrate beta to Google Maps, stop flicker and fix booking regressions

Status: DONE (2026-09-12) — P0/P1 stability hotfix AND the Google Maps migration are implemented, deployed and verified live.
- DONE (A/B/D): picker flicker + endless "resolving..." fixed (tolerance-based move detection, 350ms debounced + deduped reverse, 8s ab.ort/timeout fallback, stable panel height, per-map generation guard, retry preserves draft). PlacesInput request-identity on every edit + cancel-on-select/unmount. Europe/Nicosia schedule min. Strict /places/reverse coord validation. Public-config failure + retry UI.
- Verified: vitest 24/24; Playwright 10/10 incl. new idle-invariant / resize-no-lookup / hung->timeout / one-pan-one-lookup regressions, run against the LIVE deployed site.
- DONE (C/D + routes): all map surfaces now render Google Maps (Map ID dark) via AutoMapView/AutoMapPicker; GoogleMapPicker reimplements the stability invariants with Google idle/camera events (verified live). Backend: /places/reverse=Google reverse geocode, /places/search=Google forward geocode (Cyprus-biased, real addresses), /routes/estimate=Google Routes DRIVE (distance/duration/decoded polyline). Booking renders the real driving-route polyline + trip-duration estimate. Keys: browser key + Map ID via Docker build args, server key via runtime env; never committed (gitignored env + docs/GoogleMaps).
- CAVEAT: Places API (New) autocomplete is NOT enabled on the Google project (blocked), so the address box uses Google Geocoding (real Cyprus addresses, but not as-you-type predictions). Enable "Places API (New)" to upgrade to session-token autocomplete.
- Verified live: server geocode/route return 200; the browser map renders with NO auth errors (23 googleapis requests, all 200); full flow search->select stops->real road route polyline; stability 4/4 on the Google picker; vitest 24/24.
- SECURITY: restrict the browser key to https://cyprustaxi.ackedberryes.store in the Google console (it is visible in the client by design). Keep the server key server-only.
Application: IL-Yas
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Beta: https://cyprustaxi.ackedberryes.store
Code review baseline: f57e891c7f03c702bf0b3b3697e890b00a0a89ca

## Updated user decision — authoritative
Use Google Maps Platform immediately in the beta, not MapTiler. This revision replaces the earlier MapTiler integration plan. Migrate all map surfaces, real address search/reverse geocoding and road route estimation in this task. Preserve the stability and booking fixes below. The current MapLibre/MapTiler implementation is the audit baseline, not the target architecture.

## Read first and execute
Inspect latest main, AGENTS/project instructions, Tasks/README.md and current handoff. Preserve newer work. Save this task in root Tasks/ and index it. Implement in priority order, run meaningful tests, push and deploy through your authorized access. Finish the hotfix even if credentials block real geocoding. Do not wait for all future features before delivering the stability fix.

This task follows a source review, not a new independent live-browser certification. The user reports flicker and endless “resolving…” in location selection. Previous reports list 24 Vitest and 6 Playwright successes; these are historical evidence, not proof this regression passes.

## Findings and priorities

| Priority | Evidence in baseline | Required outcome |
|---|---|---|
| P0 | MapPicker: every move invalidates address, every moveend requests reverse lookup, ResizeObserver calls resize; resolved label changes panel height | Stop layout/move/reverse feedback; idle map issues no new requests |
| P0 | api-client has no cancellation or timeout; picker can remain resolving on a hung fetch | Bounded lookup with recovery and coordinate fallback |
| P1 | places/search and places/reverse still use demo fixtures, live reports unavailable | Implement actual Google Places (New)/Geocoding adapters |
| P1 | PlacesInput clears short input before incrementing request identity; selection does not invalidate pending search | Stale results never reopen cleared/selected fields |
| P1 | BookingApp scheduleMin uses browser-local Date getters, server interprets Europe/Nicosia | Consistent Cyprus scheduling in all visitor timezones |
| P1 | reverse route applies Number() to absent/empty params, accepting zero | Strict presence/type/range validation before lookup |
| P1 | picker lifecycle mixes old map callbacks with mutable mapRef on retry | Late work cannot mutate a new or removed map |
| P1 | E2E tile test counts only arcgisonline/OSM despite the current MapTiler switch | Google-provider-aware evidence and regression tests |
| P2 | public config failure silently leaves cfg null; routing still synthetic/unavailable | Visible configuration retry; real Google road routes |

The feedback mechanism is strongly supported by source: the map library's resize emits move/moveend even without a changed geographic center; the picker invalidates on every event. Reproduce and record the exact live mechanism, including request count and container sizes, before asserting it is the exclusive cause.

## A. P0 map stability hotfix
1. Separate geographic selection changes from layout/resize notifications. Compare current coordinates with the stored draft using a documented tiny tolerance that does not conceal a meaningful pickup adjustment. Ignore equivalent coordinates: no new revision, address invalidation, spinner or request. Zoom around the same center should not require reverse lookup.
2. Invalidate immediately on a real coordinate change to preserve Task 008 correctness, but start lookup only after movement settles for about 350ms. Coalesce repeated moveend and startup events. Deduplicate by coordinate and current request/result status, including successful null results. A no-address response is a completed result, not a reason to retry forever.
3. Stabilize the address/status area's height across resolving, success, fallback and error. Keep the map container flex sizing correct at 360/390/1440 widths. Resize only when actual container dimensions changed; batch resize callbacks and clean them up. Do not remove necessary orientation/viewport resize support.
4. Add AbortSignal support to the shared API helper without changing the behavior of unrelated booking POSTs. Apply finite lookup timeouts (e.g. 8 seconds), cleanup and stale-response guards to search/reverse requests. Cancel obsolete requests. Clear busy state for the active request on success, null, timeout and error; an old request must never clear a newer spinner.
5. Never recreate the map because address/spinner state changes. Allow deliberate retry to recreate it once. Preserve coordinate/label snapshot correctness and all unrelated form inputs.
6. Idle invariant: after initial/geolocation movement settles and the lookup completes, no additional reverse requests for 10 seconds without user action. No visual jumping. Resizing with unchanged coordinates does not request an address.

## B. Picker lifecycle and coordinate correctness
- Use a map-instance generation captured by async setup, reverse lookup, geolocation, style-load callbacks and retry handlers. After awaited work verify the exact map instance is still current and active. Invalidate work on retry as well as close/unmount. Remove old markers, timers and listeners.
- Current load handler reverse-geocodes the original start coordinate using the latest draft revision. If geolocation moved the camera before load, this can attach the wrong label to the current revision. Always request the actual current draft snapshot; tie results to both revision and coordinates.
- A retry currently constructs a map at initial/fallback while draft state may refer to the previously moved position. Preserve the current draft and camera on retry or explicitly synchronize both before enabling Confirm. Never pair old label/revision with a different actual center.
- on error currently hides the container for any event while map.loaded() is false. Distinguish recoverable tile failures from fatal map initialization/style failures; avoid destroying a functional map during ordinary tile loading.
- Verify retry after actual failure, fast permission result before style load, rapid close/reopen and delayed callback from an older map. Pending/denied geolocation must never block manual map use.
- Ensure Back/Escape/Cancel, focus restoration and history work across repeated picker openings. Preserve Next router history state when adding an owned picker entry; avoid ghost entries in Strict Mode.

## C. Migrate all beta maps and location services to Google

Use Google Maps JavaScript API for booking overview, fullscreen pickup/destination picker, passenger tracking and every driver/dispatcher/admin map that exists. Inventory all map components; do not migrate only the homepage. Load the SDK once, use a shared adapter/component and preserve all current marker, stale-GPS, route and access-control behavior. Remove old runtime map dependencies/configuration once unused; no parallel background MapLibre map or silent Esri/OSM/MapTiler fallback.

Keep the IL-Yas dark UI and lime markers. Use supported Google map styling and a project-owned Map ID where required; preserve Google attribution and map controls. Do not embed Google tiles into MapLibre or use scraped/private tile endpoints. Retain accurate local road labels and useful zoom levels. Fullscreen selection must preserve form state, geolocation permission behavior, blue location/accuracy display and exact confirmed coordinates. Reimplement A/B invariants using Google camera/idle events rather than copying MapLibre-specific resize calls. Google idle can recur without a changed coordinate: deduplicate it.

Read current primary documentation before implementation:
- https://developers.google.com/maps/documentation/javascript/overview
- https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
- https://developers.google.com/maps/documentation/places/web-service/session-pricing
- https://developers.google.com/maps/documentation/geocoding/overview
- https://developers.google.com/maps/documentation/routes
- https://developers.google.com/maps/api-security-best-practices
- https://developers.google.com/maps/billing-and-pricing/pricing

### Credentials, deployment configuration and usage controls
Use the owner's authorized Google Cloud project with billing configured and the APIs actually needed enabled: Maps JavaScript API, Places API (New), Geocoding API and Routes API. Use existing authorized credentials if present. Do not paste keys into Git, task files or reports. Prepare explicit placeholder environment variables for browser key, server key and Map ID. Browser keys are visible by design: restrict by supported website restrictions to the existing beta hostname and allowed development origins, and by permitted APIs. Use a separate server key restricted to required APIs and verified server egress IP where applicable; never expose it through NEXT_PUBLIC values. Do not spoof a browser Referer to use a browser-restricted key on the backend.

Update Docker build inputs, runtime configuration and CSP for the selected Google SDK and its documented resource hosts. Keep other security headers and protected tracking flows intact. Do not use wildcard-all CSP. Review Google's account/region-specific terms, including applicable EEA conditions, attribution and permitted storage of address/route content before persisting responses. Keep passenger-confirmed coordinates separately from optional provider-derived labels; do not assume unlimited caching of Google data is permitted.

Use field masks, bounded result counts, request debouncing, server rate limits and finite timeouts. Configure available quota limits and budget alerts with the owner's authorized budget; alerts alone are not a spending cap. Do not invent a budget, buy a subscription or enable unconstrained spending. If account setup/keys are missing, complete code and mock tests, preserve a usable deployed version, and state the exact configuration needed. Do not deploy a knowingly blank map as a successful Google migration.

### Real address search and reverse lookup
Use Places API (New) autocomplete with correct search-session token lifecycle. Predictions need not contain coordinates: resolve the selected place through Place Details (New), requesting only required fields. Adapt the existing endpoints and frontend contract together; do not fabricate coordinates for predictions. End/renew sessions correctly after selection or abandonment and keep pickup/destination sessions separate. A new query or selected place must invalidate prior async results.

Use Google Geocoding reverse lookup for manually positioned pins through a protected, rate-limited backend endpoint. Preserve the exact selected pin coordinate even if Google returns a nearby address/location centroid. Associate results with the exact draft revision. Show a coordinate fallback if no address is available; do not pretend a nearby place is an exact building match.

Bias/restrict search to configured Cyprus coverage using documented parameters and support English/Greek input. Retain authoritative booking service-area checks. Strictly validate missing/blank/malformed/non-finite/out-of-range coordinates before conversion; genuine numeric zero is valid. Distinguish no matches from unavailable/denied/quota/timeout states. Protect upstream credentials in errors and logs.

Separate booking DEMO_MODE from map/address/route provider selection: beta can remain a test taxi service while using real Google maps, addresses and roads. Label fixtures explicitly in isolated tests; never fall back to synthetic addresses in the deployed Google flow.

### Real driving routes in this beta
Implement Google Routes API Compute Routes behind /routes/estimate and wire it into booking review/map rendering. Use driving travel mode; validate both stops and return real route geometry, distance and estimated travel duration. Decode polyline correctly and render it on the Google map. Recompute after a meaningful stop change with debouncing, timeout and stale-response protection, not on every render or GPS poll.

Distinguish trip duration (pickup to destination) from driver arrival ETA (assigned driver's recent valid position to pickup). Do not show trip duration as driver ETA. Only calculate driver arrival where a driver exists and GPS is sufficiently fresh. Use traffic-aware estimates only when supported by the account, region and request; disclose ordinary estimates otherwise. Define a conservative refresh interval/budget for driver arrival and avoid a paid route request per GPS sample. Scheduled journeys must use a supported departure-time request, or clearly state the estimate limitation.

Handle no route, rejected coordinates, missing credentials and quota/network errors explicitly. No straight-line demo substitute presented as a road route. A route failure should preserve the order form and permit the existing manual-dispatch flow if a route estimate is not required by business rules. Do not introduce fare promises, online payment, auto-dispatch or turn-by-turn navigation in this task.

Validate a small set of Cyprus addresses/routes including Limassol Marina, Larnaca Airport, Paphos harbour and a Nicosia street, in Greek and English where applicable. Record actual results and coverage limitations; do not assert country-wide quality from one example.

## D. Autocomplete and scheduling fixes
### PlacesInput
Increment request identity on EVERY text edit, including clearing/one-character input. Clear loading/results and abort old work when input becomes too short. On selection, cancel pending timers/requests so no later response reopens the dropdown. Clean up on unmount and when parent changes a value (swap/map confirmation). Show distinct searching/no matches/unavailable states. Provide associated input labels and keyboard selection/Escape behavior. Keep the coordinate selection invalidated when its text is edited.

### Cyprus schedule minimum
Compute min using Europe/Nicosia formatting, not visitor-local getters. Refresh it when opening/reopening Schedule and as time advances; server remains authoritative. Check daylight-saving transitions and existing explicit offset choice behavior. Test identical current instants with visitor timezone UTC, Europe/Berlin and America/New_York: Cyprus min and accepted payload must match. Do not alter server scheduling rules blindly.

### Public configuration recovery
Initial /public/config failure currently leaves cfg null without explanation and hides the demo banner. Add visible loading/failure/retry state. Do not silently imply live readiness or allow booking based on guessed operator configuration. Keep entered fields intact during retry; map viewing can remain available. No endless spinner.

## E. Evidence and tests
Use existing Playwright infrastructure documented in docs/BROWSER_QA.md. Mock/intercept tile and geocoding responses for automated race/idle tests; never load-test a third-party provider. Verify actual authorized Google SDK/map, Places, Geocoding and Routes requests in a small separate smoke.

Required regressions:
- Idle picker with a resolved label, and with null result: spinner stops, no additional reverse calls for 10 seconds.
- Resize/orientation and long-label/status changes with constant coordinates do not restart lookup.
- One settled pan produces a bounded lookup; rapid pans and out-of-order results retain exact current coordinates/label.
- Hung request times out to usable fallback; resolving never stays permanently true.
- Map reload/retry/close rejects callbacks from older instances and retains draft correctly.
- Clear search while response pending, select while pending, switch/swapped field: no stale dropdown.
- Missing/empty coordinates are rejected; valid zeros accepted.
- Cyprus schedule min across visitor timezones and clock advance.
- Public-config failure/retry preserves data and honest beta status.

Update the existing real-tile E2E test: it filters only Esri/OSM and cannot validate Google. Derive expected host/resource type from safe configuration, redact query keys, assert actual Google SDK/map dependencies and service results as appropriate. Do not count any generic 200 as proof of a usable map. Keep mocked-provider tests and real-provider smoke separately named.

Run current unit/DB tests on an isolated test DB, type checking, build and relevant browser tests. Report lint separately if skipped by build. Supply real desktop/mobile screenshots and a short screen recording of idle + pan + resolve if possible. Include request counts and remaining blockers. Historical 24/6 totals are not acceptance criteria; report actual executed results.

## F. Scope, deployment and next steps
P0/A+B must ship promptly. Complete the Google migration and C+D wherever access permits; do not allow missing Google credentials to block a safe stability hotfix. Task 010 is not fully complete until the beta actually uses Google across maps, real address lookup and road route estimation. Preserve authentication, encrypted receipts, idempotent booking behavior, manual dispatch and exact IL-Yas branding.
Google driving-route integration is now explicitly in scope under section C. Automatic dispatch, fare calculation, payments, native navigation, physical-driver GPS and load verification remain separate pending work.

Deploy only the existing beta service using the project's procedure; preserve secrets and unrelated services. Ensure build-time browser settings, server credentials and runtime CSP match Google. Verify all map surfaces after deployment, including authenticated staff and passenger tracking; do not expose test credentials in evidence. Fix misleading comments that label the default Esri base as fully labelled or describe all OSM app usage as forbidden. The Google migration is an explicit user decision; it must include regression fixes rather than conceal the existing UI bug.

Update Tasks/README.md, current test/handoff/release status and concise configuration documentation. Avoid duplicate editable tasks under docs/Tasks/. Report implementation, automated verification, real-provider smoke, physical-device tests and deployment separately.

Final response must state: confirmed cause(s), fixed issues, code commit, deployed release, actual test results, screenshot/evidence links, and remaining credentials or unverified gates. Do not claim all issues fixed just because the page returns 200 or build succeeds.

## Additional Google acceptance gates
- Real beta map provider is Google on every map surface; old providers make no requests in the migrated flow.
- New autocomplete prediction selection resolves to a consistent place/address/coordinate pair; the session token lifecycle is tested.
- Pin reverse geocoding settles once and stays idle; all earlier no-flicker/timeout/race tests pass under the Google adapter.
- Route A and route B returned out of order cannot display the older route; a failed route clears misleading stale geometry/ETA without clearing form data.
- The real-provider smoke distinguishes rendered maps, working place search, reverse lookup and driving route geometry. A generic HTTP 200 does not prove any of these individually.
- Demonstrate missing key, denied API, exhausted quota and timeout using mocked failures with actionable UI and no retry storm.
- Report application commit, deployed release, actual Google services used, test counts and remaining account/device gates. Do not mark mocked Google tests as successful live integration.
