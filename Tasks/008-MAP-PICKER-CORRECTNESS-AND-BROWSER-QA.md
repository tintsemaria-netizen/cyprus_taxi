# Task 008 — Map picker correctness, browser QA and task organization

Status: DONE (2026-09-12) — coord/address consistency + lifecycle fixed; **real-browser
QA executed** (Playwright in Docker, chromium 6/6) with screenshots; root Tasks/ created
with index; deployed. Also fixed a real map regression found during QA: OSM tiles were
403-blocked and Carto now watermarks — switched the demo basemap to Esri Dark Gray (no
key/watermark). Actual test totals: **vitest 24/24 (14 unit + 10 DB on isolated _test DB)
+ Playwright 6/6 browser**. Physical-device Android/iPhone GPS, 10-min load, and real
geocoding/routing remain PENDING (separate work). Evidence: docs/BROWSER_QA.md,
docs/qa-screenshots/.
Priority: High — complete before treating the mobile booking flow as verified.
Application: IL-Yas
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Beta: https://cyprustaxi.ackedberryes.store
Review baseline: bdbf21756417a1f9bedc434bc1295a8aa4bcda41

## Execution instructions
Read repository instructions and current handoff/test reports, inspect the latest main and preserve newer work. Implement this task, verify it, commit/push through your authorized access and deploy the existing beta service. Do not just describe a plan. Do not reapply Tasks 005–007 blindly or use old patches. Keep the exact visible brand IL-Yas, current infrastructure identifiers and existing demo-mode boundaries.

## 1. Fix coordinate/address consistency (confirmed code issue)
Review src/components/booking/MapPicker.tsx. At the baseline, map movement updates center but retains addr. Reverse-geocoding starts on moveend, and confirm() independently reads the current map center and the retained addr. Therefore a passenger can confirm coordinates B labelled with the address of A. Request ordering alone does not solve this: an earlier response may arrive during a subsequent drag, before that drag starts its next request.

Required behavior:
- Treat the selected coordinate and its resolved label as one versioned draft. Tie each address result to the exact coordinate/revision requested.
- Invalidate the previous resolved label and pending request identity as soon as the draft coordinate changes, including manual dragging, keyboard movement and programmatic recentering.
- While moving or resolving, show the current coordinates and optionally a short resolving indicator. Never display an old address as the address of a new point.
- Confirm one consistent snapshot. If no address for that exact selection has resolved, commit the current coordinates with a coordinate-derived label; do not wait indefinitely or reuse a stale label.
- Apply results only to the still-active selection and picker instance. Ignore old successes AND failures after movement, switching field, confirmation, cancellation or unmount.
- Debounce reverse lookup appropriately. Abort requests where supported, but also use identity checks because cancellation alone is insufficient.
- A stored label may be retained when reopening its exact saved coordinate; moving invalidates it.
- Preserve the other stop and every unrelated booking field. Demo fixtures must remain explicitly demo and real providers must not be simulated.

Reproduce with delayed/intercepted responses: resolve A, move to B, immediately confirm before B resolves. The result must contain B coordinates and either B's verified label or B's coordinate fallback, never A's label. Also resolve A while a drag toward B is still in progress, and deliver older responses after newer ones.

## 2. Check and harden adjacent picker lifecycle
These are code-review risks to reproduce, not claims of already observed browser failures:
- showUser() imports asynchronously and adds an accuracy source/layer without waiting for map style readiness. Ensure an immediate cached location fix before map load is safe. Guard removed maps and stale callbacks after all awaited work; clean up markers/listeners. Exercise map initialization failure and retry/cancel.
- Geolocation results must not hijack the camera after manual movement. For My location, take a fresh interaction generation: it may recenter if the user has not moved since that click, but a delayed response must yield to a newer drag.
- Verify history handling. The baseline removeEventListener with a new anonymous function does not remove the actual callback. Use owned listener references and picker history identity, preserving router state. Repeated open/confirm/cancel and browser Back/Forward must not leave phantom entries, double-close or navigate away unexpectedly.
- Verify keyboard dismissal, focus restoration, body-scroll restoration, 100dvh/safe-area layout, resize and orientation changes. Keep manual selection usable after denied/unavailable/timed-out geolocation.
- The accuracy circle currently caps its radius at 3000m. Do not imply greater accuracy than the device reported: either render the reported uncertainty sensibly or visibly disclose a capped/coarse estimate.
Fix reproduced problems within this scope and record the evidence. Do not redesign unrelated booking or GPS backend services.

## 3. Run actual browser QA
A headless server does not by itself prevent browser automation. Check available tooling and use Playwright or an equivalent headless browser if installable through authorized access. Keep test fixtures and destructive setup on isolated test storage, never the production database. Do not weaken permissions or access controls to install tools.

Required checks:
1. Desktop 1440x900 and mobile 390x844 plus 360px wide: full booking form, picker opening for both fields, visible controls and no horizontal overflow.
2. Map pan/zoom, confirm, reopen, cancel, Escape and Back; all form data and the other stop survive.
3. Slow/out-of-order reverse responses, failure/null response and immediate confirmation produce consistent label/coordinate pairs.
4. Geolocation granted, denied, timeout and cached immediate success; late result after a manual drag or picker close is harmless.
5. Rapid open/close/reopen and pickup/destination switching cause no uncaught browser errors, removed-map updates or incorrect history navigation.
6. Scroll/focus recovery, long addresses and viewport changes work. A loading/unavailable map cannot accidentally confirm an unseen fallback selection.
7. IL-Yas header, favicon and title load; current beta notices and map attribution remain visible as appropriate.

Add focused automated regressions for the state/race defects. Use a real browser for interaction/layout evidence; geolocation and network outcomes may be mocked deterministically, but label them as mocked. At least one browser smoke should load the actual configured map tiles; mocked tiles cannot prove external tile loading works.
Capture real screenshots of desktop booking, mobile booking, full-screen pickup and full-screen destination. Screenshots must show implementation, not generated concepts. Store useful evidence and commands in repository docs with links; exclude cookies/tokens/personal data.
Run existing relevant tests, type checks and production build. Report lint separately if build skips lint. The prior report recorded 24 passing tests; report your actual current totals, not copied numbers. Database-dependent tests require an isolated test database and cannot count as passed if skipped.
Physical Android Chrome/iPhone Safari checks require actual devices. If unavailable, mark pending; emulation is not physical-device GPS verification. A 10-minute load exercise and real geocoding/routing integration remain separate pending work, not completion prerequisites for these targeted UI fixes.

## 4. Establish root Tasks/ as the canonical task folder
The user explicitly requested root Tasks/. At the review baseline, tasks 005–007 were under docs/Tasks/.
- Inventory docs/Tasks/, lowercase tasks/ and any existing root Tasks/ first.
- Move active numbered task documents into root Tasks/ with history-preserving moves where possible. Preserve their contents, status notes and historical task records; do not overwrite conflicting files or delete unrelated lower-case documents.
- Add this file as Tasks/008-MAP-PICKER-CORRECTNESS-AND-BROWSER-QA.md.
- Create Tasks/README.md as the entry point with links, priorities and separate implementation, automated QA, browser QA, physical-device QA and deployment status where relevant.
- Update active references; leave a short pointer at the former task location for Claude sessions using the old path. Avoid two editable copies of the same task.
- Correct overly broad DONE wording where required acceptance checks remain pending. Keep historical test evidence, but place the current release status prominently in handoff/test/release documentation.

## 5. Delivery and acceptance
Deploy only the existing IL-Yas/Taxi Cyprus beta service through the established process, preserving secrets and unrelated server services. Record rollback procedure and deployed application commit/release identifier; a later documentation-only commit may differ and should be explained. Verify HTTPS health and the deployed picker behavior where browser access permits.

Task is accepted when inconsistent coordinate/address confirmation is prevented with regression evidence, scoped lifecycle failures are resolved, root Tasks/ exists with an index, and browser checks/screenshots are supplied. If a required check is blocked, finish all possible implementation/deployment work and explicitly identify the remaining gate, attempted command and concrete blocker. Do not mark the entire task verified merely because the page returns HTTP 200 or TypeScript builds.

Final handoff must include:
- code commit and deployed release;
- concise changed behavior;
- actual test commands/results and screenshot links;
- pending browser/physical-device/load/provider work listed separately;
- next recommended task: real Cyprus address lookup and road routing after this picker flow is verified.
