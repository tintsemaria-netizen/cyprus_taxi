# Task 005 — close verified residual defects and validate the web beta

Status: DONE (2026-09-11) — all five areas implemented; 24/24 tests on an isolated _test DB; tsc+build pass; redeployed. Browser and physical-device gates remain UNVERIFIED (no browser/phone on this headless server).
Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Reviewed main: 73501623eceab40d65dcf16334225542435374d2
Authorized beta: cyprustaxi.ackedberryes.store / 92.39.53.229

## Start from current work

Read CLAUDE.md, docs/Tasks/Task.md, docs/HANDOFF.md, docs/TEST_REPORT.md and current Git state. Preserve Task 004 and newer changes. Do not reapply the older ChatGPT patch over the current implementation. Task 004 introduced meaningful fixes; this task addresses remaining defects found in that implementation.

The user requested new Markdown assignments in root Tasks/. Existing tasks are in docs/Tasks/ and lowercase tasks/. Establish root Tasks/ as the index for NEW tasks without deleting or renaming existing directories or breaking references. Account for case-insensitive developer filesystems; do not force destructive case-only renames. Store this task there when practical.

## 1. Reproduce and fix Cyprus autumn DST ambiguity

Source: src/lib/timezone.ts, nicosiaWallTimeToUtc.
Observed by executing the function from the reviewed commit:
- 2026-09-11T12:00 -> 2026-09-11T09:00:00.000Z (correct).
- 2026-03-29T03:30 -> GAP (correct).
- 2026-10-25T03:30 -> ok, 2026-10-25T01:30:00.000Z (incorrectly chooses one occurrence).

On the autumn transition, 03:30 occurs at both 00:30Z (UTC+3) and 01:30Z (UTC+2). The current two-candidate offset iteration can produce only the later candidate and never identify ambiguity. Enumerate relevant offsets around the transition and round-trip them through IANA data, or use a suitable verified timezone implementation.

Require the passenger to select the occurrence when ambiguous. Preserve server-side validation and the selected offset/instant through review, API submission and dispatch display. Strictly validate the complete input format. Add unit tests for summer/winter, spring gaps, autumn folds with both explicit choices, invalid dates and a visitor timezone different from Cyprus. Do not claim DST support based on one ordinary UTC+3 example.

## 2. Prevent provider names from enabling fixtures in live mode

Sources: src/app/api/v1/places/search/route.ts and src/app/api/v1/routes/estimate/route.ts.
Current checks return unavailable only when demoMode is false AND the provider environment variable is absent. If GEOCODER_PROVIDER or ROUTER_PROVIDER is nonempty, execution falls through to searchPlaces/demoEstimate. searchPlaces is a static fixture list, not a real adapter. Address results can therefore be marked demo:false despite being fixtures.

In live mode dispatch only to an actually implemented, validated provider adapter. A name/key alone is insufficient. Until an adapter exists, return a clear unavailable response for both unset and arbitrary/nonimplemented provider names. Never call fixture functions from that path. Add tests for demo on, demo off/unset, demo off/unknown name, provider failures and configured supported adapter behavior when one exists. UI must explain unavailability and retain map pin selection where possible.

Real provider integration is the next product phase after this verification gate; do not silently implement an unlicensed public-service fallback or claim keys alone complete it.

## 3. Tracking outage and recovery

Source: src/components/track/TrackApp.tsx.
On non-401 load failure, only reconnecting is set. Existing view.location and its freshness remain unchanged, so the previous fresh marker can still appear live. If the first request fails, phase can remain loading. A transient fragment exchange failure is treated as invalid authorization and removes the token, preventing a straightforward retry.

- Age the last known position locally or hide it upon disconnect; never keep an old fresh label/ETA.
- First-load failures must show an actionable retry state rather than an endless loading message.
- Distinguish rejected/expired tokens from network/server failures. Preserve a safe retry capability on transient failure without logging/exposing the token or falling back to a previous booking cookie.
- On revoked authentication clear protected state; keep polling non-overlapping.
- Browser tests: initial 503, later polling outage, recovery, expired token, transient exchange failure, existing unrelated cookie plus bad/new token. Confirm no old booking is revealed.

## 4. GPS and operational concurrency follow-up

Source: src/server/location.ts.
The conditional update protects sample time, but within-session sequence is checked before the write and not in its condition. Add a DB regression for concurrent increasing timestamps with reversed sequence numbers. Preserve BOTH monotonic requirements. When two initial samples race to create the first row, the newer loser currently gets dropped; reread/retry with bounds if appropriate. Catch only recognized uniqueness/concurrency failures; unexpected DB failures must not be mislabeled OUT_OF_ORDER.

Driver activation/duty checks occur separately from persistence. Review races with off-duty/deactivation. Also inspect admin vehicle binding/deactivation checks versus assignment transactions. Introduce consistent transaction/locking rules if needed; prove invariants using isolated PostgreSQL concurrent tests. Never use the running customer/beta database for destructive test setup.

## 5. Evidence and release gate

Task 004 report says 17 total unit+DB tests passed and the beta was redeployed. Independently run tests for the checkout used here; do not interpret 17 as 17 database tests or inherit another session's pass claims.

- Run existing and new focused tests on an isolated *_test PostgreSQL database; missing prerequisites must fail clearly.
- Run TypeScript check and production build. Report lint separately; current build skips it.
- Run actual browser scenarios at 1440x900, 390x844 and 360px: continuous typing, address selection, scheduled booking, assignment, tracking, cancel/reassign/complete, keyboard visibility and no overflow. Store real screenshots and test logs. HTTP curl flows are not browser verification.
- Validate foreground GPS on a real phone over HTTPS when a phone/tester is available. Check permission denied, on-duty sharing before assignment, page backgrounding/return and location freshness. Never claim guaranteed background GPS.
- Run the specified 10-minute synthetic load exercise only on isolated staging resources when available; otherwise explicitly leave that gate unverified.

Before deployment preserve unrelated services/vhosts and back up affected data. Keep TRACKING_RECEIPT_SECRET stable. The current receipt format is v1: AES-GCM (Claude implementation); do not replace it with the different older patch format. Confirm rollback image can read encrypted receipts.

Deploy the verified Taxi Cyprus service, smoke-test through public HTTPS and record the actual source SHA/image digest. Add a safe release identifier to health/version output or container metadata if needed so deployed version can be checked; expose no secrets. Update BETA_RELEASE.md: its header still points to the initial bad20ba commit and old 12/12 totals. Remove obsolete NOT pushed statements where GitHub now has the changes.

## Completion

Mark DONE only with evidence for executed gates. Report separately: implemented, locally tested, DB tested, browser tested, physical-device tested and deployed. Update docs/HANDOFF.md with exact next steps before session/context limits; continue autonomously through routine implementation and verification. If a dependency is missing, finish independent work and name the precise blocker.

After this task: implement a real Cyprus address/geocoding and road-routing adapter, verify actual pickup ETA, configure operator coverage/contacts, then run a small supervised fleet pilot. Native Android/iOS development follows validation of the web flow and the chosen driver tracking approach.
