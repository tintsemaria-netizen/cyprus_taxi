# Task 009 — Restore blocked tiles and fix map picker loading

Status: TODO
Priority: High — visible beta map failure
Application: IL-Yas
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Beta: https://cyprustaxi.ackedberryes.store

## Problem and evidence
The user supplied a screenshot with repeated OpenStreetMap “Access blocked / 403” tiles across the booking map. Some normal tiles remain visible; this does not establish that current requests succeed, because tiles may be cached.

In the reviewed source at bdbf21756417a1f9bedc434bc1295a8aa4bcda41:
- src/lib/config.ts defaults to https://tile.openstreetmap.org/{z}/{x}/{y}.png.
- src/middleware.ts sets Referrer-Policy: no-referrer.

This configuration suppresses the web Referer required by OSM and is a concrete policy mismatch. It is the leading explanation, not yet a proven exclusive cause of the user's live block. Verify the actual deployed response and browser tile requests before declaring the root cause confirmed.

Official reference: https://operations.osmfoundation.org/policies/tiles/
Read its current requirements before changing the integration.

## Execute
Read repository instructions and current task/handoff status. Inspect latest main, preserve newer changes including Task 008, and implement this fix rather than returning only a plan. Save this document under root Tasks/009-FIX-OSM-TILE-403.md and update Tasks/README.md. If task-folder migration is still pending, coordinate it without duplicating editable task files.

### 1. Diagnose the effective configuration
- Inspect map configuration and all relevant header sources: Next middleware/config, HTML referrer metadata, map request overrides, reverse proxy and any accessible Cloudflare response-header rules.
- Check the effective Referrer-Policy served from the public HTTPS hostname, not just localhost.
- Inspect browser tile requests: actual host, Referer, status, response content and caching behavior. Distinguish provider denial, CSP/network errors and map rendering failures.
- Do not record cookies, session/tracking tokens or personal data in committed diagnostic evidence.

### 2. Apply the minimal compatible fix
- Replace the blanket no-referrer policy on map-bearing pages with strict-origin-when-cross-origin, or an equivalently scoped policy that sends the actual site origin to the HTTPS tile service and preserves protection of sensitive URLs.
- Confirm external tile requests carry only the site origin, never passenger tracking paths, query parameters or tokens. Keep tokens out of URLs where existing security design requires it; preserve receipt encryption and authentication behavior.
- Remove conflicting restrictive overrides in project-controlled configuration. If an inaccessible edge rule overrides the fix, identify the exact remaining blocker rather than claiming deployment succeeded end-to-end.
- Keep the canonical HTTPS tile endpoint, visible correct attribution and existing CSP protections. Do not loosen CSP to wildcard origins or disable unrelated security headers.
- Preserve normal browser caching and honor provider cache headers. No cache-busting query parameters, systematic no-cache requests, forced download loops or bulk prefetch.
- Do not spoof another app, rotate identities/IPs, add an anonymous proxy or switch OSM subdomains to evade a provider block.
- If compliant requests remain blocked, stop repeated retries, document the denial and use the provider's support/unblocking process or prepare an explicitly supported alternative. Do not activate a paid provider or invent credentials; report any required account/configuration separately.

### 3. Fail gracefully
Check both the overview map and full-screen picker. On detected persistent tile/network failure, show a compact honest “Map temporarily unavailable” state and a bounded explicit Retry action. Preserve entered booking data and offer existing address-entry behavior. Do not silently substitute fake tiles/coordinates or confirm an unseen fallback position. If a provider serves an error graphic as an otherwise successful image, do not claim HTTP status handling can reliably detect its contents; record this limitation and verify visually.

### 3A. Fix the map not loading when selecting a location (additional user-reported defect)
The user reports that clicking “Set pickup on map” or “Set destination on map” opens a picker whose map does not load. Treat this as a separate required fix within Task 009. Do not assume fixing the OSM Referer automatically fixes picker initialization.

- Reproduce both entry points from the booking form. Inspect console errors, tile requests, map load/style events and the rendered container dimensions. Distinguish a provider block from a zero-height container, hidden/unmounted canvas, WebGL failure or initialization race.
- Initialize the map only after its visible container is mounted with nonzero width and height. Ensure flex ancestors allocate the remaining viewport height and the map canvas fills that space. Call the library resize method after opening, layout transitions, viewport changes and orientation changes; use a container resize observer where appropriate and clean it up on close.
- Verify dynamic import and component lifecycle, including development Strict Mode, slow imports, rapid close/reopen and switching fields. Do not reuse a removed map or stale container. Reset per-instance loading/error/closed flags correctly and cancel stale setup callbacks.
- Map initialization and tile loading must proceed independently of geolocation. Denied, pending or timed-out permission must never leave the map blank or prevent manual selection. A cached fast geolocation result must not add sources/layers before style readiness.
- Show a visible bounded loading state, then a useful error if loading fails. Retry must recreate or recover the map after fixing the cause; merely hiding the message is insufficient. Preserve form data through loading, error, retry and cancel.
- Keep Confirm disabled while the map cannot display the selected position. Do not allow an invisible default coordinate to be submitted. A single recoverable tile error must not permanently destroy an otherwise usable map; handle initial unavailability and partial failure deliberately.
- Preserve the full-screen selection behavior: booking form collapsed, map fills the available screen, pin and controls visible, Back/Cancel restores the original form without data loss.

Required additional acceptance checks, using mocked/test tiles for automated tests:
1. Both buttons open a visible, correctly sized map on desktop and mobile, on first open and repeated opens.
2. Immediate geolocation success, delayed response and permission denial all leave the map usable.
3. Slow map-library/style/tile loading produces a loading indicator, then a map or a recoverable error; no infinite blank screen.
4. Closing while loading and reopening creates exactly one working map without stale callbacks or uncaught errors.
5. Confirm and Cancel preserve the Task 008 coordinate/address guarantees and unrelated form inputs.
6. After deployment, include separate actual screenshots of the pickup and destination pickers. Verify real-provider loading through modest normal human browser use as specified below. Report mock-based verification separately.

### 4. Verify without stressing OSM
The OSM public tile service is not a load-test target. Use mocked/intercepted or self-hosted test tiles for automated pan/zoom/retry and failure scenarios. This instruction supersedes any earlier task language that could be read as requiring automated sweeps against OSM. Perform a small normal human browser smoke with the real provider and normal caching; do not use headless bots to force-download map areas.

Required evidence:
1. Public page serves the intended effective Referrer-Policy.
2. Normal real browser tile requests carry the correct origin Referer; response status and visual content show map tiles rather than Access blocked graphics. A cached tile or page HTTP 200 alone is insufficient proof.
3. Booking overview, pickup picker and destination picker display correctly in a normal desktop/mobile viewport smoke. Keep provider traffic modest.
4. Automated mocked failure checks preserve form state, show a useful error and avoid retry storms; the Task 008 coordinate/address consistency behavior remains intact.
5. No new CSP errors or uncaught map exceptions in the tested flow.
6. Relevant existing checks and production build pass; report lint separately if skipped by build.

If a browser is unavailable, complete code/header checks and deployment where authorized, but explicitly mark real tile-request and visual verification pending. Do not call curl with forged browser identity and describe it as browser evidence. Separate emulated layout checks from physical-phone testing.

## Deployment and handoff
Commit and push through your authorized repository access. Deploy only the existing IL-Yas/Taxi Cyprus service using the established procedure, preserving secrets and unrelated server services. Rebuild if required by configuration changes. Verify public HTTPS headers after deployment and record the actual deployed application commit/release identifier.

Update task index and current handoff/test report with:
- confirmed root cause versus any remaining hypotheses;
- changed files and effective public policy;
- redacted representative tile request evidence and real screenshots if available;
- actual tests and deployment result;
- any persistent provider block or unavailable verification.

Acceptance: map tiles load without the reported block under compliant browser requests; both location-selection buttons open a working full-screen map on first and repeated use; booking/picker state is preserved; and evidence identifies the deployed fix. Code completion, deployment and visual verification are separate statuses; do not mark the entire incident resolved without the last check.
