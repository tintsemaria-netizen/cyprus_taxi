Task 004 — fix and verify Taxi Cyprus beta

Status: DONE (2026-09-11) — implemented from this standalone task (the referenced
Taxi-Cyprus-Review-Fixes.zip / commit d4ed77b was not available in this environment,
so fixes were implemented directly and reconciled with the ae17116 baseline).
Evidence: 17/17 tests pass on an isolated `taxi_cyprus_test` DB; tsc + production
build pass; redeployed to https://cyprustaxi.ackedberryes.store and smoke-tested
(idempotent retry, Nicosia-tz schedule, origin guard, USE_ASSIGN block, full
assign→GPS→COMPLETED). See docs/TEST_REPORT.md and docs/BETA_RELEASE.md.

What was fixed (all verified):
- assignments.ts: business failures now THROW so transactions roll back; reassignment
  validates the new candidate BEFORE ending the old assignment (a failed reassign
  preserves old assignment/driver/revision — regression test added). Row `SELECT … FOR
  UPDATE` lock serializes competing revisions (lost-update race fixed). Generic status
  change rejects `ASSIGNED` (USE_ASSIGN) so it can't fabricate an assignment.
- bookings.ts/tracking.ts: idempotency claim + booking + event + grant + response are
  one atomic transaction (no orphan bookings); response is AES-256-GCM encrypted (no
  raw token at rest); receipt is replayed BEFORE time-dependent schedule validation.
  Guarded legacy migration (scripts/migrate-receipts.ts) re-encrypted existing plaintext.
- location.ts: on-duty drivers may share GPS before assignment (fleet visibility);
  off-duty rejected; older timestamps rejected across sessions; duty/activation rechecked;
  guarded conditional write against concurrent samples. Driver UI updated.
- BookingApp.tsx: form/review inlined (inputs keep focus); schedule sent as Europe/Nicosia
  wall time and converted server-side (DST gap/fold handled); idempotency key preserved
  across Edit unless payload changes; PlacesInput ignores stale async results.
- TrackApp: failed fragment-token exchange no longer falls back to an old cookie; polling
  starts after init and never overlaps.
- Origin/CSRF guard on cookie-authorized API mutations (blocks sibling subdomains).
- Demo ETA/geocoding gated to explicit demo mode; unconfigured "around-the-clock/island-wide"
  copy removed. Queue orders immediate before scheduled (explicit NULL handling).
- Seed requires DEMO_MODE=true + supplied DEMO_PASSWORD, no defaults, no password in logs.
- DB tests: explicit `_test` DB gate (fail, never silently skip) + regression tests for
  reassignment rollback, competing revisions, atomicity, encrypted-at-rest and GPS concurrency.

Remaining honestly-unfinished (not claimed done): physical-phone GPS unverified; ~10-min
load exercise not run; real map/geocoder/router providers not configured; admin
binding/deactivation-vs-assignment races, terminal-grant retention cleanup jobs, OpenAPI
spec doc and lint config are noted for a later pass.

--- original task below ---

Status: TODO
Created: 2026-09-11
Repository: tintsemaria-netizen/cyprus_taxi
Target: https://cyprustaxi.ackedberryes.store on 92.39.53.229

Execution

Read CLAUDE.md and applicable repository instructions first. Inspect current code and Git state; preserve newer work. Implement the fixes below, run meaningful tests and deploy only the Taxi Cyprus beta service. Continue through routine milestones autonomously. Do not mark skipped tests as passed.

The reviewed baseline was ae171167f89e1c02f01419396da708115df633d7. ChatGPT prepared local corrections in commit d4ed77b15f3008ad65021e6adebfdb53ee78345d, delivered separately as Taxi-Cyprus-Review-Fixes.zip. That commit was not pushed or deployed by ChatGPT. If the package is available, review/apply its patch on a clean branch and reconcile newer changes. If unavailable, implement from this standalone task; do not block on the ZIP.

Required corrections

src/server/assignments.ts: returning an error result after ending an assignment commits prior writes. Ensure rejected business operations roll back the transaction. A failed reassignment must preserve the old assignment, driver availability and booking revision.

Serialize competing booking mutations, including cancellation/start-trip races. Revision checks and mutations must be atomic. Return 409 on write conflicts, never accept two commands against one revision. Reassignment must validate availability and require acknowledgement of stale/missing GPS. Generic status changes must not create ASSIGNED without an actual driver/vehicle assignment.

src/server/bookings.ts and src/lib/tracking.ts: atomically persist idempotency claim, booking, initial event, tracking grant and recoverable response. Recover the same booking/token after response loss. Replay an existing receipt before time-dependent schedule validation. Do not leave orphan bookings after grant/receipt failures.

Encrypt stored retry responses with authenticated encryption, random nonce and a domain-separated key; do not persist raw tracking tokens. Enforce expiry. Provide a guarded legacy receipt migration, preserving the current TRACKING_RECEIPT_SECRET. Existing empty receipts require reconciliation: never delete and resubmit blindly. Old application builds cannot read encrypted receipts; rollback must retain a compatible reader.

src/server/location.ts: reject older timestamps across GPS sessions as well as within one session; protect read/check/write against concurrent samples. Recheck driver/user activation and duty at ingestion. Allow explicitly enabled foreground GPS for on-duty drivers before assignment so dispatch can see available fleet positions. No off-duty GPS. Update driver UI accordingly.

src/components/booking/BookingApp.tsx: nested FormBody/ReviewBody components defined inside the parent remount on state changes. Keep input and PlacesInput identity stable so typing retains focus. Preserve an idempotency key when returning through Edit without changing the payload. Prevent old asynchronous place results from replacing newer results.

Interpret schedule fields as Europe/Nicosia wall time, independent of visitor timezone. Convert through IANA timezone data, reject spring DST gaps and require explicit choice for repeated autumn times. Display review time consistently.

Tracking: failed fragment-token exchange must never fall back to a previously stored booking cookie. Start polling only after initialization; do not overlap requests or retain apparently live vehicle data after update failure.

Add explicit origin protection for cookie-authorized API mutations, including sibling origins, while allowing legitimate non-browser API clients. Enforce roles on server.

Keep synthetic ETA/geocoding strictly in explicit demo mode. Real-data mode must report unavailable when real adapters do not exist; adding environment variables is not an implemented provider. Remove unconfigured around-the-clock/island-wide promises.

Sort immediate requests ahead of scheduled ones where specified; explicitly handle SQL null ordering.

Seed: require explicit DEMO_MODE=true and a supplied generated password; remove default credentials. Never seed customer data or expose credentials in Git/logs.

tests/booking.db.test.ts: remove silent early success when DB or fixtures are absent. Use an explicit isolated-DB gate, fail on missing prerequisites, and add regression tests for reassignment rollback, competing revisions, booking atomicity and GPS concurrency.

Verification

Install with lockfile; generate Prisma; run unit/service tests, TypeScript check and production build.

Run database tests on an isolated PostgreSQL DB with a name ending in _test. Do not use the running beta/customer DB. Seed test fixtures only into this isolated DB.

Test full passenger request → dispatcher assignment → driver GPS/statuses → passenger updates → completion, plus cancellation, reassignment, lost-response retry and unauthorized access.

Browser QA at 1440x900, 390x844 and 360px width: continuous typing, address selection, no horizontal overflow, schedule conversion with browser timezone America/Los_Angeles, repeated time choice, invalid tracking link and network retry. Fixture-intercepted UI tests do not prove DB behavior.

Verify actual physical-phone foreground GPS if a device is available; otherwise report it unverified.

ChatGPT's local correction checks were 24 passed and 7 DB tests skipped; production build passed. Browser installation and local PostgreSQL were blocked. Do not reuse these results as evidence that your checkout or deployment passed.

Deployment

Inspect /home/claudeuser/projects/cyprus_taxi and actual host configuration. Preserve unrelated services/vhosts. Back up the database, keep existing secrets, apply compatible receipt migration/release and deploy only this beta. Verify HTTPS readiness, complete synthetic trip and persistence after restart. Record release commit, URLs, checks and rollback compatibility.

Remaining review items

Review admin binding/deactivation race conditions with assignments, configured GPS threshold wiring, terminal tracking-grant retention, cleanup jobs, real provider adapters, OpenAPI and lint configuration. Record unfinished items honestly rather than claiming production readiness.

Progress and continuation

Tasks/ is the user-requested folder for new Markdown assignments. Preserve the existing lowercase tasks/ directory; on case-insensitive systems do not destructively merge or rename it. If necessary, read Tasks directly from GitHub using its exact path.
Update this task status to IN_PROGRESS/DONE/BLOCKED and record concrete evidence. Save progress, commit/branch, remaining changes and exact next action in docs/HANDOFF.md before session/context limits. Resume from those files without starting over. Never claim automatic account/model/session switching.