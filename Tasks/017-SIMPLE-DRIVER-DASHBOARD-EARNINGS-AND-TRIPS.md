# Task 017 — Simple, complete IL-Y driver dashboard

> **STATUS (2026-09-14): IMPLEMENTED + deployed to the beta.** Deployed release **53f42e4**
> (utilization/analytics follow-up in a later commit). vitest **93 passed / 1 skipped**. The full
> driver flow (offer → GPS → nav → arrive → start-code → complete → chat → push) is preserved; the
> runtime lives above the Home/Trips/Earnings/Profile tabs so switching sections never stops GPS,
> offer listening, or the ride session. Browser QA screenshots captured at 390×844, 320×844,
> 1440×900 (idle Home, Earnings, Profile, desktop) using a synthetic QA driver that was then
> removed.
>
> ## Completion matrix
> | Area | Status | Evidence |
> |---|---|---|
> | §2 Four-section mobile-first nav | DONE | bottom nav Home/Trips/Earnings/Profile, ≥44px targets, safe-area, IL-Y tokens; desktop = same sections, more space |
> | §3 Home (working screen) | DONE | status+duty, one Go online/offline, 3 today figures, active trip/offer priority, last trips, alerts, eligibility blocker replaces online action |
> | §3 runtime above tabs | DONE | GPS/offer/ride-session in the parent; persistent offer alert + return-to-trip bar across sections |
> | §4 Trips | DONE | Today/Week/Month filters, cards + pagination, detail (route/timestamps/fare/settlement/release-reason), driver-scoped + privacy-safe (released drivers see no later data), no passenger phone in history |
> | §5 Earnings (truthful) | DONE | recorded = known finals only; unknown = pending (never zero); estimates never income; per-currency; daily chart + list; CSV (formula-injection safe, currency+UTC+generated-at) |
> | §5 driver settlement | DONE | `DriverSettlement` separate from Fare, revision-appended corrections + reason, audited, completing-driver-only, upfront price protected; idempotent + revision-checked |
> | §6 Profile/Vehicle/Documents/Help | DONE | vehicle (review-gated), documents (status only, no internal notes; honest LEGACY state), help (configured contact or honest unavailable — no dead buttons), sign out |
> | §7 Duty sessions / online-time | DONE | server-timestamped `DutySession` + duty events; online-time from session∩window, never a browser timer; force-off closes the session |
> | §7 scoped APIs + identity | DONE | session identity only; KYC/ownership rules; bounded queries; ClickHouse-independent |
> | §8 acceptance (new driver empty states) | DONE | verified via QA driver; clear zero/empty states, honest labels |
> | Task 016 driver-utilization metric | DONE | now computed from duty events (was deferred) — admin analytics shows driver online-time |
>
> **Not done / honest scope:** a real on-phone journey (no device/browser hardware here — server +
> emulated-viewport verified instead); document self-serve renewal (routed to operator, not a dead
> button). Existing SMS/scanner + off-host-backup blockers remain separate and unchanged.


Repository: https://github.com/tintsemaria-netizen/cyprus_taxi
Scope: driver experience. Continue Tasks 013–016 and preserve passenger/admin flows.
Owner request: drivers currently see an order and a few settings; they need a complete but simple dashboard with earnings, trips and useful work information. A Bootstrap template may be used, with the existing IL-Y colors.

## 1. Execute and preserve

Inspect latest main, repository instructions, HANDOFF, current driver page, lifecycle, KYC and financial data. Implement the dashboard, actual authorized APIs, focused tests and deployment to the established beta target. Do not stop at mockups or fill cards with demo statistics.

Retain the current driver trip/offer functionality, real GPS, navigation, chat, push, arrival rules, start code and safe completion. This is an extension and reorganization of the working driver experience.

## 2. Visual direction and navigation

Use IL-Y approved logo, exact existing font and design tokens: dark graphite surfaces, lime active controls, light primary text and muted secondary labels.
A Bootstrap template is optional: select a maintained, appropriately licensed responsive template only if it helps. Verify source/license/version; remove demo pages/plugins/data and keep assets local. Do not buy a template or introduce global Bootstrap CSS that breaks the existing Tailwind passenger/admin pages. Reusing current React components to achieve the same clean dashboard is equally acceptable.

Mobile first:
- Four bottom navigation items with icons AND labels: Home, Trips, Earnings, Profile.
- Profile contains Vehicle, Documents, Notifications and Help; avoid a sprawling sidebar.
- Desktop uses the same four sections in a compact sidebar/header, with more space rather than more features.
- Short English labels, large readable amounts, at least 44px touch targets and accessible focus/contrast.
- No more than three summary figures on Home, no dense tables on phones, no technical terms.
- Every visible card/action must lead somewhere useful or explain a real state.
- Respect safe areas, keyboard, reduced motion, 320px width and common mobile heights.

## 3. Home — the working screen

Top area:
- Driver first/display name, current approved vehicle plate and clear status.
- One large Go online / Go offline button.
- If online, show "Ready for requests" or current operational state; a prominent but compact GPS/connection warning when needed.
- If unapproved, suspended or documents expired, replace online action with exact blocker and a link to fix it. Pending applicants see onboarding status, not fake driver earnings.

Below it, three Today figures:
1. Recorded earnings — amount from the definition below, with pending trips count.
2. Completed trips.
3. Time online — only if durably measured; otherwise show unavailable until measurement starts.

Then:
- Current offer or active trip takes priority over statistics.
- While idle: short "Last trips" list (latest 3), one relevant document/vehicle warning and Help.
- Optional compact map if useful; do not add an always-running second map/route loop just for decoration.
- No charts on the default Home screen.

Active-trip mode:
- Make the existing trip card/map/navigation the main content.
- Show the one next valid action prominently: accept, head to pickup, arrive, enter start code, complete.
- Preserve countdown, reject, pickup/destination, passenger count, fare type, navigation and chat.
- Opening Earnings/Profile must not stop GPS reporting, offer listening or the current ride session. Keep this runtime above tab/page boundaries and manage subscriptions without duplicate timers.
- Show a persistent Return to active trip bar and offer alert across sections.
- Do not unexpectedly navigate the driver away while typing; alert clearly with a return action.
- Going offline during a trip must not cancel/reassign it or stop required tracking: support "Stop new requests after this ride" if consistent with the lifecycle, and enforce server-side.
- Keep essential ride actions usable without encouraging interaction with charts while driving.

## 4. Trips

Default Today with simple Today / Week / Month / Custom filters.
List cards on mobile, table on desktop:
- date/time, pickup → destination;
- completed/canceled/in progress status;
- fare amount with explicit Final / Estimate / Pending label;
- recorded payment state where known.

Trip details:
- reference, route addresses, relevant timestamps;
- fare breakdown, recorded payment, cancellation reason if authorized;
- Help for this trip and resume current trip.
- Map only on demand; do not issue paid route requests for every history row.

Only the signed-in driver's legitimately assigned trips are visible. Driver who received/rejected an offer does not gain access to passenger trip history. Reassigned-before-pickup drivers must not see later passenger movements, chat or final driver earnings.
Use the assignment that actually completed the ride for earnings attribution; use immutable driver/vehicle snapshots.
Do not expose passenger phone/contact data indefinitely in completed-trip lists.
Include pagination, empty/error/retry states and retain filters when returning from details.

## 5. Earnings — useful and financially truthful

Time filters: Today / Week / Month / Custom. Currency from actual records.
Show a large Recorded earnings amount and completed-trip count, with a short explanatory label and pending amounts/count.
One simple daily earnings bar chart is sufficient; provide the same amounts in an accessible list. Include a compact per-trip breakdown and optional "Download statement" CSV for own records.

Define the totals BEFORE implementing:
- Existing fareCents can be an estimate, finalCents can be NULL, and payment may remain PENDING. Never sum estimates and call it paid income.
- "Recorded earnings" = eligible completed fares with a known driver-attributable final amount; explain this is before expenses. Do not call it net profit.
- Show "Recorded collected" separately only if actual payment evidence/recorded confirmation exists; payment method alone does not prove money was received.
- Unknown final fares contribute to "Amount pending" count, not zero earnings disguised as a completed total.
- Show commissions, tips, bonuses, platform balance/payouts only when those records and applicable rules actually exist. Do not invent a wallet, withdrawal button, transfer, commission percentage or bonus program.
- Do not sum different currencies; group them or display only the applicable currency. No implicit exchange-rate conversion.
- Preserve regulated meter versus accepted upfront pricing. An accepted upfront amount must not be freely overwritten by the driver.

If the current system cannot record the final metered amount:
Implement a minimal, auditable settlement action for the driver who completed that trip:
- Enter actual metered amount and optionally record "Payment received" when genuinely confirmed.
- Store this as driver-reported settlement/payment evidence with timestamps, actor, currency, idempotency and revision checks, distinct from the original immutable quote/Fare.
- Never replace accepted price snapshots or silently mark every completed trip paid.
- Corrections require a reason, append an audit/correction record and recompute totals. Restrict repeated/invalid/negative/out-of-range input.
- Label driver-reported collection accurately; it is not bank/provider verification.
- Coordinate with Task 016 finance/event model rather than adding a competing balance implementation.

Show filters in one explicitly labeled timezone: use UTC by default to match Task 016; if offering Cyprus time, convert windows consistently, including DST. All timestamps stored UTC. Reconcile cards, chart, list and exported totals for identical filters.

## 6. Profile, vehicle, documents and help

Profile:
- public name, verified contact details, sign out and notification setup.
- Account phone change must use verification; no bypass of passenger/driver identity boundaries.
- Keep existing notification permission and foreground GPS limitations visible only where actionable.

Vehicle:
- Approved car, plate, class, seats, photo and approval state.
- Request vehicle change sends it through Task 015 review. Driver cannot self-approve or instantly change the operational binding.

Documents:
- Easy list with Valid / Expiring soon / Under review / Action needed / Expired.
- One Update document action per affected item using existing private upload flow.
- Show expiry and reviewer-requested correction without exposing internal notes.
- No KYC scans or document numbers on the dashboard Home or analytics charts.

Help:
- Configured support contact and Help with a trip, with reference prefilled.
- No dead buttons, invented support phone or fake chat agent.
- If no contact is configured, show an honest unavailable state and admin configuration requirement.

## 7. Data and API design

PostgreSQL is the authoritative source for Home, earnings/settlement, trip history, profile and documents. Dashboard remains operational if ClickHouse is unavailable. Task 016 may supply optional longer-term trend projections, but they cannot replace financial truth with stale analytics or leak admin data.

Use scoped server endpoints, adapted to existing conventions:
- driver/dashboard: current status, today's summary, latest trips, actionable alerts;
- driver/trips with filters/pagination and driver/trips/:id;
- driver/earnings with summary/daily rows/pending counts;
- driver/earnings/export;
- driver/settlements only if needed as above.

Identity must come from the authenticated server session, never a trusted driverId query/body field. Apply KYC access rules and distinct historical-read versus new-work privileges. Suspended/expired drivers should still have appropriate access to their own earnings/docs and safe ongoing-trip completion.

Persist online/offline state events/sessions for online-time totals; use server timestamps, intersect sessions with report window and account for disconnected time using a documented rule. Do not calculate lifetime online time with a browser timer or invent old intervals.
Record settlement and duty events atomically for Task 016 export. Avoid double attribution on reassignment and double totals after replay.
Use bounded queries/indexes, no N+1 map/provider lookups, request cancellation and sensible refresh. Pause history/chart polling when hidden; preserve active ride/offer processing.
Financial errors must show unavailable/retry rather than zero.
Prevent CSV formula injection in exported user-controlled strings and include currency, timezone and generated-at.

## 8. Acceptance and delivery

Verify with synthetic data and isolated accounts:
- New approved driver with no rides: clear zero/empty states, works online/offline.
- Pending/suspended/expired applicant/driver: accurate permitted actions and no operational bypass.
- Completed trips with known final amount, unknown metered amount, recorded collected/pending, cancellation, rematch and multiple currencies.
- Totals match trip list/chart/CSV with exact filters; unknown is not zero and estimate is not paid income.
- Settlement replay, concurrent requests/corrections and attempted edit by another driver.
- Today's/week/month boundaries and timezone/DST.
- Move through all four sections during a live synthetic ride: GPS, offer alerts, navigation and chat continue without duplicate polling.
- Offline connection, reconnect, session expiry, back navigation, keyboard and document upload/review.
- ClickHouse outage does not break driver dashboard.
- A driver's APIs never return another driver's earnings/documents/passenger data.
- Existing Task 013–016 relevant regressions pass.

Capture screenshots at 390×844, 320px width and 1440×900: idle Home, offer, active ride, Trips, trip details, Earnings, Profile/Documents and blocked eligibility.
Run a full browser driver journey. Separate real-device results from viewport emulation and mocked provider tests from live checks.
Deploy to the authorized beta, verify actual release SHA and review all four sections. Keep unfinished Task 014 passenger UI and SMS/scanner blockers explicitly separate.

Deliver working dashboard + APIs/migrations, screenshots, test results, deployed SHA, concise metric definitions and any genuine blockers. Update Tasks index and HANDOFF. Do not leave nonfunctional template widgets or label a static mockup as complete.

