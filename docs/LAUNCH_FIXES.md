# IL-Y Taxi Cyprus — fixes before the commercial pilot

- Branch `launch-fixes` (not merged to `main`; `main` autodeploys). Work done 2026-11-19/20.
- **Status words**
  - FIXED AND VERIFIED — fixed, and an automated test or local browser run passed.
  - IMPLEMENTED NOT VERIFIED — code written, not proven by a test or device.
  - EXTERNAL BLOCKER — needs a key, a decision or a device we do not have.
  - NOT STARTED.
- **Source labels**
  - *PDF* — described in the task.
  - *code* — confirmed by reading the code.
  - *test* — automated test run on an isolated `_test` Postgres.
  - *browser* — local Chromium run.
  - *device* — real phone. **None used.**
- Commands and results are in `docs/VERIFICATION_REPORT.md`.

> **Before merging:** the defaults changed.
> - Real orders now need an SMS-verified phone.
> - Ride-share is off.
>
> To keep today's open testing on il-y.taxi, set `PASSENGER_TEST_MODE=on` (and `SHARE_ENABLED=on` if wanted) in the server env **before** the merge reaches production. Without Twilio and with test mode off, passengers cannot order. See `docs/PILOT_RUNBOOK.md` §1.

## §3 P0 — configuration, OTP, documents (KYC), e-mail

| # | Pri | Code path | Consequence before | Fix | Verification | Status |
|---|---|---|---|---|---|---|
| 3.1 | P0 | `.env.example`, `docker-compose.yml` | Many vars undocumented or not passed to containers. The `SMS_DEV_OTP_ALLOWLIST` was never passed, so driver code sign-in could not work without Twilio. | Full inventory in `.env.example`; switches and the allowlist passed through compose. | code | IMPLEMENTED NOT VERIFIED (compose not run here) |
| 3.2 | P0 | `src/server/readiness.ts`, `GET /api/v1/admin/system`, admin «Надёжность» | Missing SMS, ClamAV, e-mail or push was invisible. | Dependency states (ok / warn / missing, names only, no secrets) shown to the admin. ClamAV is probed live. | code + typecheck; UI not screenshotted | IMPLEMENTED NOT VERIFIED |
| 3.3 | P0 | `src/instrumentation.ts` | A missing secret failed only on first use. | `APP_ENV=production` refuses to boot without `SESSION_SECRET`, `TRACKING_RECEIPT_SECRET`, `DATABASE_URL`. | code | IMPLEMENTED NOT VERIFIED |
| 3.4 | P0 | `src/lib/config.ts` (`allowDevOtp`) | `SMS_ALLOW_DEV_OTP=true` returned test codes in production. | Test codes are refused whenever `APP_ENV=production`. No fixed test code (000000 etc.) exists anywhere (audit). | code | IMPLEMENTED NOT VERIFIED |
| 3.5 | P1 | `*/otp/verify` routes | Only a per-IP limit; guesses could be spread over IPs. | Added a per-phone limit (10 per 10 min). The login/OTP limiter now **fails closed** on a storage error. | code | IMPLEMENTED NOT VERIFIED |
| 3.6 | P0 | Twilio Verify path `src/server/sms.ts` | — | Already correct (code checked by Twilio, 10 min expiry, dev path attempt-limited). | code | EXTERNAL BLOCKER: Twilio account + Verify service needed; real SMS delivery never tested |
| 3.7 | P0 | `src/server/scan.ts` | Scanner errors looked like «unavailable»; a file stored while the scanner was down stayed unscanned forever. | States are CLEAN / INFECTED / ERROR / UNAVAILABLE (pending). Maintenance re-scans pending files; an infected file is deleted and returned for re-upload. Only CLEAN can be accepted or approved (unchanged). | test `scan-states.db.test.ts` (fake clamd) | FIXED AND VERIFIED (logic). ClamAV service itself: EXTERNAL BLOCKER (not in compose; needs ~1 GB RAM) |
| 3.8 | P0 | `src/server/applications.ts` | A driver could be approved with licence or insurance **without an expiry date**, so the expiry watcher never fired. | Licence, taxi licence, insurance and roadworthiness need a **future** expiry to be accepted or approved. | test `applications.db.test.ts` | FIXED AND VERIFIED |
| 3.9 | P1 | `deploy/nginx-*.conf` `client_max_body_size 2m` | PDFs over 2 MB rejected by nginx (the app allows 20 MB). | `deploy/nginx-il-y-taxi.conf`: 21 MB on the upload route only. The operator copies it to the server and reloads (runbook §6). | code | IMPLEMENTED NOT VERIFIED (nginx not run here) |
| 3.10 | P1 | KYC privacy | — | Already correct: private volume, 0600, magic-byte typing, ADMIN-only streaming, no public URL (audit). | code | FIXED AND VERIFIED by audit; no new test |
| 3.11 | P0 | `src/server/email/receipts.ts` | Enabling Resend would have sent up to 7 days of old receipts. A meter receipt was e-mailed **before** the driver entered the real amount. | Without a provider, due e-mails are SKIPPED (no backlog blast; the passenger can still request a copy). A meter receipt waits up to 20 min for the amount and is released as soon as the driver enters it. Limited retries (6) and no duplicates (unique per booking + idempotency key) already existed. | test `receipt-email.db.test.ts` (6 cases) | FIXED AND VERIFIED |
| 3.12 | P1 | failed receipt e-mails | Visible only in logs. | Count shown in admin alerts (`GET /admin/alerts`). | code | IMPLEMENTED NOT VERIFIED |

## §4 P0 — verified passenger phone

| # | Code path | Before | Fix | Verification | Status |
|---|---|---|---|---|---|
| 4.1 | `src/lib/config.ts`, `src/lib/features.ts` | Guest ordering was a **hard-coded constant** — on in every environment. | `PASSENGER_TEST_MODE` (default **off**) — one server switch, reported in public config and admin system status. | test | FIXED AND VERIFIED |
| 4.2 | `src/app/api/v1/bookings/route.ts` | Any signed-in account could order with a typed phone. | Server rule: no session → 401; no **SMS-verified** account phone → 403 `PHONE_VERIFICATION_REQUIRED`. The booking always uses the account phone; a phone typed in the body is ignored. | test `launch-passenger-phone.db.test.ts` | FIXED AND VERIFIED |
| 4.3 | `BookingApp.tsx`, `PassengerLoginModal.tsx` | — | The form shows «Подтвердить телефон по SMS». On 403 the SMS step opens and the **same order** (route, class, time, note) is resent after the code. The server re-checks price and time. | **browser**: order → 403 → code → 201 → tracking | FIXED AND VERIFIED (Chromium, iPhone 13 profile; not on a device) |
| 4.4 | `passenger/otp/verify` `attach` | A phone verified later created a **separate** account, so history split. | `attach` puts the number on the **same** account (history and active ride stay). A number owned by another account → 409 `PHONE_IN_USE`, never a silent merge. | test | FIXED AND VERIFIED |
| 4.5 | unwanted-pair rule | — | Passenger identity = account id (stable). With a verified phone required, one person cannot easily open throw-away accounts. Merging two existing accounts is a manual support action (not built). | code | IMPLEMENTED NOT VERIFIED |
| 4.6 | board and share link | — | The free-orders board and the shared link carry no passenger phone (audit + existing test `share-trip`). | test | FIXED AND VERIFIED |

## §5 P0 — assignments

The database already guarantees one active assignment / offer per booking, driver and vehicle (unique indexes). Every path locks the booking row (audit).

| # | Code path | Before | Fix | Verification | Status |
|---|---|---|---|---|---|
| 5.1 | `worker.ts rematchOnGpsLoss` | A driver assigned while his last fix was old was rematched on the **next tick** (≤ 2 s). A phone with a fast clock stretched the 90 s window to about 150 s. | The window counts from **server receive time** and never starts before the assignment. | test `launch-races` (2 cases) + `lifecycle` | FIXED AND VERIFIED |
| 5.2 | `lifecycle.rematchBooking`, `assignments.unassign/reassign` | The driver who lost the ride got **no notice**; the trip silently vanished. | Push «Ride reassigned / removed» + driver banner «Заказ снят с вас…» (8 languages). | test (push row asserted) | FIXED AND VERIFIED (push delivery to a phone: not verified) |
| 5.3 | `driver/settlement.ts` | A correction without the revision it corrects could overwrite a parallel one. | Revision required. | test | FIXED AND VERIFIED |
| 5.4 | race tests | — | Two drivers accept at once; accept after expiry (existing); cancel vs accept (existing); rematch vs «arrived»; staff unassign vs «start»; old driver back online; double «complete»; double amount entry; parallel corrections. | test `launch-races.db.test.ts` (8, run 3× green), `lifecycle-guards` | FIXED AND VERIFIED |
| 5.5 | SSE / tracking | — | Not changed; the existing tests pass. | test | FIXED AND VERIFIED (no regression) |

## §6 P0 — price and final total

| # | Code path | Before | Fix | Verification | Status |
|---|---|---|---|---|---|
| 6.1 | `src/lib/fare-total.ts` (new) | The receipt added app waiting to the **estimate** and called it a total. Earnings ignored waiting on fixed prices. History hid «≈». Admin analytics ignored the driver's amounts. | One rule used by receipt, history, e-mail, driver earnings / analytics / trips and admin money:<br>• **Fixed price** = price + recorded pickup waiting.<br>• **Meter** = the driver's taximeter amount only (the meter already counts waiting — **no double waiting**).<br>• Otherwise «≈ estimate».<br>States: ESTIMATE → AWAITING_AMOUNT → AMOUNT_CONFIRMED → PAID. | test `fare-total.test.ts`, `receipt-email`, `driver` | FIXED AND VERIFIED |
| 6.2 | corrections | — | Already audited (revisioned settlements, reason required). Now also require the revision. | test | FIXED AND VERIFIED |
| 6.3 | `POST /driver/bookings/:id/payment-received` | A fixed-price ride could **never** be marked paid. | The completing driver confirms payment (idempotent, audited); button in the trip details. | code + typecheck | IMPLEMENTED NOT VERIFIED (no test for the route; logic shares the tested lock pattern) |
| 6.4 | capacity | Bags were not checked against the class. | Bags above `LUGGAGE_MAX_COMFORT` / `_XL` (4 / 7) → 422. Note: the normal order form does not ask for passengers or bags (they go in the note, by owner decision 2026-11-13); share orders send both. | test | FIXED AND VERIFIED (server). Child seat: **NOT STARTED** — no fleet data on seats, so nothing is promised. |
| 6.5 | payment method | Always `CASH_TO_DRIVER`. | Not changed. No card terminal or acquiring is claimed anywhere. Card at the driver's terminal = open product question. | code | EXTERNAL BLOCKER (decision) |
| 6.6 | Cyprus tariff | — | See below. | web sources | EXTERNAL BLOCKER (operator / RTD confirmation) |

**Tariff check (2026-11-20).**

The two links in the task (visitcyprus.com, RTD «TAXI v.2.0» PDF) could **not be opened from this session**. They need to be read by the operator. Checked instead against the official decrees on cylaw.org:

- **Urban meter.** ΚΔΠ 293/2022, in force from 1 Aug 2022:
  - Day: €3.80 start, €0.95/km, €17/h waiting.
  - Night (20:30–06:00): €4.80, €1.10/km, €19/h.
  - Extras: public holiday €2.00, luggage €1.40 per piece, +20 % with 5 passengers, +40 % with 6 passengers.
  - `src/lib/tariff.ts` uses exactly these figures. Its name `cy-urban-2026-09-13` is **our** version label, not a 2026 regulator decision.
  - A taxi reform was announced for 2026 (press), so a newer notice may exist. **Not found; not confirmed.**
- **Airport fixed fares.** ΚΔΠ 79/2021: e.g. Larnaca Airport–Limassol €55 day / €65 night (up to 4 pax), €70 / €85 (5–6 pax).
  - The app's fixed-zone prices are entered by the operator in admin.
  - They **must be checked line by line** against the current official list. This has not been done.
- **Not in any decree found — questions for RTD / operator:**
  1. XL +40 % for 1–4 passengers. The decree has +40 % only *when carrying 6*.
  2. The 30 % ride-share discount and splitting a meter fare between two passengers.
  3. Any dynamic price (code has a TEST-only engine, off).
  4. Pickup waiting added on top of a **fixed** airport fare (`FIXED_PRICE_ADDS_WAITING`, currently on).
  5. Whether an app may show a fare estimate before the ride at all, and in what form.
- **Nothing in this work claims regulatory approval.**

## §7 P0 — ride-share switch

| # | Code path | Fix | Verification | Status |
|---|---|---|---|---|
| 7.1 | `SHARE_ENABLED` (default **off**) — `bookings.ts`, `share.ts` (`tryLiveShare`, `matchPrebookings`, `answerShare`), public config, `BookingApp` | Off means:<br>• opt-in is ignored server-side (normal ride, normal price);<br>• no new live or pre-booked pairs;<br>• a «yes» to an old proposal is recorded as «no».<br>Existing MATCHED pairs **finish normally**: same car, agreed prices, cancel / no-show rules unchanged, nothing cancelled or repriced. | test `launch-passenger-phone` (§7), `ride-share*` with the switch on | FIXED AND VERIFIED |
| 7.2 | re-enable conditions | Runbook §4: both stops in driver navigation, pairs visible to dispatch, consent / refusal flows, capacity, cancel / no-show, final totals per leg, RTD answer on discounts. | — | EXTERNAL BLOCKER (decision) |

## §8 P1 — pre-bookings

| # | Code path | Before | Fix | Verification | Status |
|---|---|---|---|---|---|
| 8.1 | `preassign.runPreassignments` | One failing ride stopped the loop (and the tick); no order. | Per-ride try/catch; earliest pickup first. | test (existing suite green) | FIXED AND VERIFIED |
| 8.2 | `preassign.convertOne` | Converted a driver who was paused, had no live GPS, or was far away. The 90-min gap only compared pickup times. | Converts only if online, accepting, GPS ≤ 90 s and straight-line ETA (×1.3 at 45 km/h, +10 min grace) reaches the pickup. Otherwise waits, then hands the ride to automatic dispatch. **No Google call under the row lock.** | test «no live GPS or too far» | FIXED AND VERIFIED |
| 8.3 | staff alerts | Lapses and late releases were invisible. | `ALERT_PREBOOK_LAPSED` / `ALERT_PREBOOK_LATE_RELEASE` audit rows → `GET /admin/alerts` → list on admin «Надёжность». | test (alert row asserted) | FIXED AND VERIFIED (UI not screenshotted) |
| 8.4 | timezone, single conversion | Already correct (Europe/Nicosia; row lock + unique `activeBookingId`). Intervals 72 h / 75 / 30 / 15 min **unchanged**. | — | code | FIXED AND VERIFIED by audit |
| 8.5 | road-ETA feasibility at commit time (90-min gap) | Still pickup-time only. | — | — | NOT STARTED |

## §9 P1 — commission (calculation mode)

Before this work, no commission existed (DriverSettlement is a driver's amount, not a commission).

| # | Fix | Verification | Status |
|---|---|---|---|
| 9.1 | Tables `CommissionRule` (version, rate in basis points, effective date) and `CommissionEntry` (append-only ledger, idempotent `sourceKey`). Additive migration `20261120010000_commission_calc`. | migration applied to a fresh DB | FIXED AND VERIFIED |
| 9.2 | `COMMISSION_MODE=calc`:<br>• accrues on the **confirmed** total when it becomes confirmed (meter amount entered / fixed price at completion);<br>• a corrected amount books an ADJUSTMENT;<br>• cancelled or unconfirmed rides accrue nothing;<br>• an unpaid ride still accrues on the confirmed amount (explicit rule). | test `commission.db.test.ts` (rounding, replay, correction, concurrent payment + accrual, partial payment, cancel, mode off) | FIXED AND VERIFIED |
| 9.3 | Admin API: rules (versioned, audited); payments / credits / write-offs with a reference (idempotent) and a reason; balances; reconciliation CSV marked CALCULATION. | test (service) | IMPLEMENTED NOT VERIFIED (routes, no UI) |
| 9.4 | **No rate is set.** 12 % is a scenario only. No demand to drivers, no debt limit (offers never blocked), no card charges or penalties. | — | — |

Open business parameters:
- rate and base (with or without waiting / extras);
- VAT on commission;
- accrual date (amount confirmed vs. ride date);
- how drivers pay (cash / transfer);
- invoice / receipt to the driver;
- debt limit and grace;
- refunds and disputes;
- commission on ride-share legs.

## §10 Security and operations

| # | Item | Fix / finding | Status |
|---|---|---|---|
| 10.1 | Staff MFA | Enforced whenever `APP_ENV=production`. All session-issuing paths were checked (audit): no bypass once TOTP is enrolled. Remaining risk: an admin without TOTP can enrol with the password alone, so enrol everyone first (runbook). | IMPLEMENTED NOT VERIFIED (existing `staff-mfa` tests green) |
| 10.2 | Authorization | All 131 routes checked (audit): owner and role checks present; no record served by id alone. | FIXED AND VERIFIED by audit + existing `routes.db` tests |
| 10.3 | Rate limits | Login / OTP fail closed; others fail open (visible). Uploads have no limit. | IMPLEMENTED NOT VERIFIED; uploads NOT STARTED |
| 10.4 | Share links | Stop working when the trip ends (completed / cancelled / no driver). Before, addresses and plate were readable for up to 12 h. | FIXED AND VERIFIED (test) |
| 10.5 | CSP | `script-src` still has `'unsafe-inline' 'unsafe-eval'` (Next + Google Maps). Needs nonces and map testing. No HSTS header in app/nginx (Cloudflare may add it — unknown). | NOT STARTED |
| 10.6 | Retention | GPS and KYC clean-ups run in maintenance (audit). | FIXED AND VERIFIED by audit |
| 10.7 | Worker / outbox | Leases, `SKIP LOCKED`, at-least-once (rare duplicate push possible). Pre-booking loop now isolated per ride. | FIXED AND VERIFIED by audit + tests |
| 10.8 | Google cost | A scheduled ride with no driver in reach re-routed every driver **every 2 s**. Now backs off 30 s. Remaining: duplicate estimate + quote call when booking; public `/routes/estimate` (30 / min / IP) — set quotas and alerts in Google Cloud. | partly IMPLEMENTED NOT VERIFIED; rest NOT STARTED |
| 10.9 | Deploy | A **failed backup did not stop the deploy** (`|| true`). Now aborts before build or migration. Rollback of the app image already existed; migrations are not rolled back (additive only in this branch). | IMPLEMENTED NOT VERIFIED (shell syntax checked) |
| 10.10 | Backup restore | Last recorded restore test 2026-09-14. No access to backups or key from here. | EXTERNAL BLOCKER |
