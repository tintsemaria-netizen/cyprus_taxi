# Verification report — launch fixes (2026-11-20)

**Where it ran:** branch `launch-fixes`, in an isolated workspace.

- Postgres 16, database `taxi_cyprus_test`. Every DB test refuses to run unless the DB name ends in `_test`.
- No production access was used. Nothing was deployed, migrated, sent as SMS or e-mail, or changed on real orders.
- External providers were stubbed or absent: no Google key, no Twilio, no Resend.
- **No real phones were used.**

## Commands actually run

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | 0 errors |
| `npx vitest run` (full suite, after all changes) | **73 files passed, 1 skipped; 351 tests passed, 1 skipped**, 41 s |
| `npx vitest run tests/launch-races.db.test.ts` ×3 | 8/8 each time |
| `npm run build` (Next.js production build) | success |
| `npm run lint` | 6 errors, all **pre-existing**, in `src/server/quote.ts:108` (a `use` helper named like a React hook). That file is untouched by this branch. Warnings are pre-existing. |
| `prisma migrate deploy` on a **fresh** empty DB `taxi_migcheck_test` | all migrations incl. `20261120010000_commission_calc` applied |
| `bash -n scripts/deploy.sh` | syntax OK (deploy itself **not run**) |
| `LOAD_DRIVERS=120 LOAD_BOOKINGS=100 tsx scripts/load-test.ts` | see Load test |
| Local server `next start` + Playwright Chromium (iPhone 13 profile), dev test codes enabled **locally only** for one test number | phone verification flow, see below |

## New or changed tests (what they prove)

| File | Proves |
|---|---|
| `tests/launch-passenger-phone.db.test.ts` (11) | No session → 401. Account without verified phone → 403 (typed phone ignored). Unverified phone → 403. Verified → 201 with the **account** phone. Attach keeps the same account and its history; a number owned by another account → 409, no merge. Empty contact field on resend is accepted. Test-mode switch. Ride-share switch off ignores opt-in; public config reflects both switches. Luggage over the class limit → 422. |
| `tests/launch-races.db.test.ts` (8) | Two drivers accept one booking → one assignment. Old GPS at assignment → not rematched next tick. Future-dated phone clock cannot stretch the window. Rematch vs «arrived» → one outcome, old driver notified. Old driver back online → his actions refused, GPS does not revive the ride. Staff unassign vs «start» → never both. Double «complete» → one completion, one fare. Double first amount → one settlement; correction needs a revision; parallel corrections → one lands. |
| `tests/fare-total.test.ts` (5) | Meter: estimate is approximate until the taximeter amount; the amount replaces it with **no waiting added**. Fixed: price + waiting, exact. States including PAID. |
| `tests/receipt-email.db.test.ts` (+2) | The meter amount releases the held e-mail at once and is the total (no «≈»). Without a provider, due e-mails are skipped; enabling later sends no backlog; a manual request still works. |
| `tests/preassign.db.test.ts` (+1) | Pre-booked driver with old GPS or ~50 km away is not converted; it lapses at the cut-off with a staff alert. |
| `tests/applications.db.test.ts` (+1) | Insurance without, or with a past, expiry cannot be accepted; forced-accepted docs without dates block approval. |
| `tests/scan-states.db.test.ts` (2) | A fake clamd returns CLEAN / INFECTED / ERROR; an unreachable scanner = UNAVAILABLE; a pending document is re-scanned to CLEAN. |
| `tests/share-trip.db.test.ts` (+1) | A shared link returns 404 after the trip ends; no address or plate in the reply. |
| `tests/commission.db.test.ts` (5) | Half-away-from-zero rounding in cents. No accrual before the amount is confirmed. Replays book nothing. A correction books an adjustment. Payment needs a reference and is idempotent. Concurrent payment and accrual. Partial payment balance. CSV has no phones. Cancelled ride and mode off accrue nothing. |
| Updated: `lifecycle`, `passenger-register`, `ride-share*`, `receipt-email` | Adjusted to the new defaults: window from assignment, verified phone, share switch on in share tests, e-mail hold. |

## Browser check (local, Chromium, not a device)

The account was signed up by e-mail with no phone. Route was current location → Limassol Marina.

1. The form shows «Подтвердить телефон по SMS» instead of a free phone field.
2. «Заказать поездку» → `POST /bookings` **403 PHONE_VERIFICATION_REQUIRED**. The SMS step opens with no sign-in tabs.
3. Test number → local test code (dev path; refused when `APP_ENV=production`) → «Подтвердить».
4. The same order is sent again automatically: **201**, then the tracking page.
5. A number already attached to another account → «This number belongs to another account» (409).

Screenshots: `/tmp/ui/lf-phone1.png` (form), `lf-phone2.png` (code step), `lf-phone3.png` (after).

## Load test (isolated, stubbed providers)

**Profile:** 120 drivers on duty around Limassol, 100 bookings fired at once, instant simulated acceptance.

- This is roughly 3–5× the expected pilot peak (20–40 drivers, a few concurrent requests a minute), to leave headroom.
- Google was not called, so ETAs are straight-line.

```
bookings submitted:    100 (created OK: 100)     single batch 499 ms wall
dispatch iterations:   3
still SEARCHING:       0      active assignments: 100
assign latency p50/p95/max ms: 3883 / 5389 / 5487
INVARIANT VIOLATIONS:  NONE
```

- The script was fixed to seed drivers as eligible. They were PENDING before, so it had silently offered nothing.
- **Not measured:**
  - SSE fan-out to many passengers;
  - GPS ingest rate (about 1 sample / 5 s / driver);
  - Postgres CPU / IO;
  - worker latency with real Google calls.

  These need a staging copy of the server. Recommended profile: 40 drivers sending GPS every 5 s, 60 open SSE tracking pages, 1 booking per 20 s, for 30 min. Record p95 API latency, worker tick duration and DB CPU.

## Not run / not verified

- **Real devices (iPhone / Android).** None available. Status **NOT VERIFIED**. Protocol below.
- Real SMS (Twilio), real e-mail (Resend), real web push delivery, a ClamAV container, Google Routes cost.
- `docker compose` build / deploy, nginx reload, backup restore, the deploy script.
- Admin screens for system status, alerts, commission and «Оплата получена» were type-checked and built, **not screenshotted**.
- CSP tightening (not started).

## Manual device protocol (for the operator)

**Setup**

- Phones: one iPhone (iOS 17+) and one Android (Chrome).
- Driver account on the driver phone. A passenger on a second phone.
- `PASSENGER_TEST_MODE` off, Twilio on.
- Record the time of each step. Note in dispatch → booking → events what the system did.

| # | Scenario (driver phone) | Expected |
|---|---|---|
| 1 | Screen on, app open, on duty → passenger orders | Offer with sound within ~5 s. Accept → passenger sees the car moving. |
| 2 | Same, but driver **locks the screen** after accepting, for 2 min | iOS: GPS stops. After ~90 s the ride is **re-dispatched**; the driver gets a push «Ride reassigned». Record the actual time. |
| 3 | App in background (another app on top) 2 min before pickup | As 2 (Android may last longer; record it). |
| 4 | Battery saver ON, screen on | Note whether the GPS interval stretches (admin → drivers → GPS age). |
| 5 | Location permission denied | Driver screen asks for location; cannot go on duty with live GPS. |
| 6 | Airplane mode / no internet for 2–3 min **during the trip** | Ride **not** reassigned. Passenger map shows stale. After reconnect, position resumes, «complete» works once. |
| 7 | Switch Wi-Fi ↔ LTE mid-trip | No duplicate actions; position continues. |
| 8 | Kill and reopen the app during a trip | The trip comes back; actions work. |
| 9 | Offer arrives while the phone is locked | Note whether a push shows and whether sound plays (iOS web push has no custom sound). |
| 10 | Passenger: order → SMS code → track; phone locked during the trip, then reopened | Real SMS arrives within 30 s; tracking resumes. |

Write the result of each row as PASS / FAIL with the times. Any FAIL in 1, 2, 6 or 10 blocks the pilot.
