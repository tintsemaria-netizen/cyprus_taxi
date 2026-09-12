# Task 011 — Fix Google Maps CSP (connect-src) blocking the vector map

Status: DONE (2026-09-12) — root cause: CSP connect-src omitted *.gstatic.com, *.google.com and data:/blob:, which the Google VECTOR map's shared-label worker fetches. This only surfaced on real GPU vector rendering, not the software-WebGL raster fallback used in the headless harness (so earlier live smokes passed while real devices saw a blank map). Fix: middleware CSP now allows data: blob: https://*.gstatic.com https://*.google.com in connect-src (+ *.google.com/googleusercontent in img-src) per Google's guidance; no wildcard, other protections intact. Verified live header + Playwright csp/stability/flow (7/7). Release below.

--- original directive ---
Fix the blank Google Maps map on the deployed IL-Yas beta:
https://cyprustaxi.ackedberryes.store

The browser console shows CSP connect-src violations blocking:
- https://www.gstatic.com/maps/res/...
- data:image/png;base64,... fetched by shared-label-worker.js

1. Inspect all CSP sources: application headers, middleware,
   reverse proxy, and HTML meta tags. Multiple enforced policies
   must all permit the required resources.

2. Update the existing policy using Google's official guidance:
   https://developers.google.com/maps/documentation/javascript/content-security-policy

   Merge the required Google Maps connect-src sources:
   https://*.googleapis.com https://*.google.com
   https://*.gstatic.com data: blob:

   Also verify script-src, img-src, style-src, font-src,
   and worker-src compatibility with the actual Maps integration.
   Preserve unrelated protections and existing required sources.
   Do not disable CSP or add a blanket wildcard.

3. Rebuild and deploy. Verify the actual response headers on the
   live site, not just the source configuration.

4. Test desktop and mobile:
   - Main map renders real map content.
   - Pickup/destination picker opens with the form collapsed.
   - Pan, zoom, geolocation and address resolution work.
   - No Maps CSP violations, flicker, or endless resolving.
   - Loading failures show an actionable error and retry.

5. Add a browser regression that detects Maps CSP violations
   and verifies map readiness. Run existing stability tests.

Report the root cause, changed files, commit, deployment status,
and live test results. Never print or commit API key values.