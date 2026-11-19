# IL-Y pilot runbook

For the operator and whoever is on duty during the limited commercial pilot (2026-11-20).

There is one server. It is a single point of failure: if it is down, ordering is down. See §7.

## 1. Before the pilot: switches and dependencies

Put real values only in the server env file (`deploy/.env.production`) or GitHub Secrets. Never commit them to Git or paste them in chat. Each line below is shown on **admin → Надёжность → Состояние системы**.

| Setting | Pilot value | If missing |
|---|---|---|
| `APP_ENV` | `production`, **after** every admin / dispatcher has enrolled 2-factor (admin → profile) | MFA not enforced; test codes allowed |
| `SESSION_SECRET`, `TRACKING_RECEIPT_SECRET`, `DATABASE_URL` | set | production refuses to start |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_VERIFY_SERVICE_SID` | set (Twilio Verify service with SMS to +357) | passengers cannot confirm a phone, so **they cannot order**; drivers cannot sign in by code |
| `PASSENGER_TEST_MODE` | **empty / off** | `on` = anyone orders without a verified phone (testing only) |
| `SHARE_ENABLED` | **off** for the public pilot | — |
| `CLAMAV_HOST` / `_PORT` | a clamd container on the private network (≈1 GB RAM) | driver documents cannot be accepted, so no new drivers |
| `RESEND_API_KEY`, `EMAIL_FROM` | set, sending domain verified | receipts only in the app |
| `VAPID_*` | set | no background notifications |
| `GOOGLE_MAPS_SERVER_API_KEY` | set, with a daily quota and a budget alert in Google Cloud | road ETAs fall back to estimates |
| `DEMO_MODE` | `false` | fixtures possible |
| `COMMISSION_MODE` | empty, or `calc` to start collecting calculations (no rate until approved) | — |

**Merging `launch-fixes` changes defaults.** Real orders now need SMS, and ride-share is off. If Twilio is not ready but testing must continue, set `PASSENGER_TEST_MODE=on` **before** the merge deploys, and treat every order as a test.

## 2. Daily checks (5 minutes)

- Admin → Надёжность:
  - no red dependency;
  - read the alerts (pre-booking lapsed / released late, failed receipt e-mails);
  - check drivers flagged for GPS loss.
- `curl -s https://il-y.taxi/api/v1/health/ready` → 200.
- Last backup file exists and is from today (§7).

## 3. GPS / assignment problems

| Symptom | What the system does | What you do |
|---|---|---|
| Driver's phone stops sending GPS **before pickup** | After 90 s the ride goes back to automatic search. The driver gets «Заказ снят с вас» (push + banner) and the passenger «Ищем другого водителя». | Call the driver if it repeats. Tell drivers to keep the screen on and battery saver off (`DRIVER_BACKGROUND_LOCATION.md`). |
| GPS lost **during the trip** | Nothing is reassigned. The passenger's map shows the car as stale. | Nothing unless the passenger calls. |
| Driver says «my ride disappeared» | It was rematched (GPS), cancelled by the passenger, or moved by dispatch. | Dispatch → booking → events show which. |
| Two drivers at one pickup | Should be impossible: the database allows one active assignment. | Take the booking reference and both driver names, and report it as a P0 bug. |
| Driver needs to be replaced | — | Dispatch → booking → reassign (reason required, audited). The old driver is notified automatically. |

## 4. Pre-bookings

- A driver's pre-booking becomes a real ride 30 min before pickup, **only** if he is all of these:
  - online;
  - accepting rides;
  - sending live GPS;
  - close enough to make it.
- Otherwise the system keeps trying, then hands the ride to automatic dispatch 15 min before pickup (20 min for a pair). A staff alert appears for this.
- A driver releasing less than 60 min before pickup also creates an alert. Call him; the passenger gets automatic dispatch.
- Pre-accepting is **not a guarantee**. Do not promise passengers a named driver.

### Ride-share (off for the pilot)

Switch it on again only when all of these hold:
- the second passenger's stops are in driver navigation;
- dispatch sees pairs;
- consent, refusal, cancel and no-show work end-to-end on devices;
- each leg's final amount is confirmed;
- RTD has answered on discounts and split fares.

While it is off:
- pairs that already exist finish normally;
- answers to old proposals can only be «no».

## 5. Money

| Ride type | Final amount | How the driver closes it |
|---|---|---|
| Meter | the car's taximeter amount | trip details → enter amount (+ «payment received») |
| Fixed price | price + recorded pickup waiting | trip details → «Оплата получена» |

- Passenger history and the receipt show «≈» until the meter amount is entered.
- The receipt e-mail waits up to 20 min for that amount.
- Corrections need a reason and are kept as revisions.
- Commission, if `COMMISSION_MODE=calc`:
  - admin API `/api/v1/admin/commission` (rules, balances);
  - `/export` (CSV);
  - `/entries` (payments, with a receipt reference).
- **No rate is approved.** Never present a balance to a driver as owed.

## 6. Documents (KYC)

- Accept a document only after a CLEAN scan.
- Licence, taxi licence, insurance and roadworthiness need a **future expiry date**.
- Files uploaded while ClamAV was down are re-scanned automatically.
- PDFs over 2 MB were refused by nginx. `deploy/nginx-il-y-taxi.conf` in this branch now allows 21 MB on the upload route only. nginx config is not deployed by `main`: copy it to the server, then run `nginx -t && systemctl reload nginx`.

## 7. Deploy, rollback, backup

- `main` autodeploys. **Merge only what you want live.**
- **Deploy** (`scripts/deploy.sh`), in order:
  1. Backup. A failed backup now **aborts** the deploy.
  2. Build. Nothing restarts unless it succeeds.
  3. Start, which runs migrations.
  4. 180 s health check.
  5. Automatic rollback of the app images if the check fails.
- **Migrations are not rolled back.** This branch adds only new tables, so the old code ignores them.
- **Manual rollback:** `docker tag` the previous `pre-…` image and restart, or revert the merge commit on `main`.
- **Backups:** daily encrypted `pg-*.dump.enc` + uploads.
  - The last recorded restore test is 2026-09-14.
  - **Before the pilot**, restore the latest dump into a separate database with `deploy/restore-verify.sh`.
  - Record how long it took.
  - That script hides `pg_restore` errors, so read its full output.
- **Single point of failure:** one VPS (app, worker, Postgres).
  - Monitoring: the watchdog plus the daily checks above.
  - If the server is lost: a new VPS, Docker, restore the latest dump + uploads, DNS. Expect hours, not minutes.

## 8. Pilot targets (internal, not industry norms)

- 100–200 real rides.
- **0** double active assignments.
- At least 90 % of pickups within 5 min of the ETA shown at assignment.
- At least 95 % of completed rides with a confirmed amount within 24 h.
- GPS-loss rematches below 5 % of assigned rides.
- Every support intervention logged.
- Failed rides are counted, not hidden.
