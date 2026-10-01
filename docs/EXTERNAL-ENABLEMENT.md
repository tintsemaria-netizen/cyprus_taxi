# External enablement — honest-gated capabilities

Every capability below is **implemented and correctly gated**: the app runs today without it and
lights it up the moment the external resource is provided. None of these is faked — where a real
resource is absent, the feature degrades honestly (a labelled test path, an honest "unavailable"
state, or a correctly-blocked action), never a simulated success. Set the listed env vars in
`deploy/.env.production` (chmod 600, git-ignored) and redeploy per `docs/HANDOFF.md`.

Deploy reminder: `export APP_RELEASE=$(git rev-parse HEAD)` then build + `up -d taxi-app taxi-worker`
(the web entrypoint runs `prisma migrate deploy`; the worker waits for the schema).

---

## 1. Real SMS (passenger + driver OTP)

- **Status:** Twilio Verify adapter implemented (`src/server/sms.ts`). Prod has only
  `TWILIO_VERIFY_SERVICE_SID`, so the **dev-OTP path is active** (labelled "Test verification";
  the code is shown in the UI, never sent, never logged in prod). This keeps the beta usable.
- **Activate real SMS:** set `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` (the Verify Service SID is
  already present). A root-owned `Twilio` credential file sits git-ignored in the repo root — do
  not commit it; copy the values into `deploy/.env.production`.
- **Then:** real SMS is used automatically; to forbid the dev path entirely leave `SMS_ALLOW_DEV_OTP`
  unset/`false`. **Verify:** request an OTP on `/login` or `/driver/login`; no `devCode` is returned
  and a real SMS arrives.

## 2. Malware scanning of uploaded KYC documents

- **Status:** clamd adapter + scan GATE implemented (accept requires `scanStatus=CLEAN`; approval
  requires all required docs CLEAN — unscanned is never approved). No reachable clamd here, so
  scans are `UNAVAILABLE` and approval is **correctly blocked** (honest, not bypassed).
- **Activate:** run a clamd reachable from the app container and set `CLAMAV_HOST` (+ `CLAMAV_PORT`,
  default 3310). **Verify:** upload a doc in `/driver/register`; its `scanStatus` becomes `CLEAN`
  (or `INFECTED`), and admin approval unblocks for an all-CLEAN application.

## 3. Google Places Autocomplete (New)

- **Status:** `/places/search` + `/places/details` implemented with a billing session token and a
  **graceful fallback to forward geocoding** when Places (New) is not enabled on the Google project
  (current prod state — addresses resolve, just not as typeahead).
- **Activate:** enable **Places API (New)** on the Google Cloud project behind
  `GOOGLE_MAPS_SERVER_API_KEY`. No code change. **Verify:** `/api/v1/places/search?q=...&session=...`
  returns prediction results rather than geocoding hits.

## 4. Commercial weather provider (demand signal for dynamic pricing)

- **Status:** weather adapter implemented with timeout + freshness + NEUTRAL fallback; providers
  `none` (default), `fixture` (tests), `open-meteo` (OFF pending commercial authorization). Never
  fabricates weather.
- **Activate:** once a provider is commercially authorized, set `WEATHER_PROVIDER` accordingly
  (and `WEATHER_MAX_AGE_MINUTES`). **Verify:** `/admin/analytics` / pricing reasons show a non-NEUTRAL
  weather contribution.

## 5. Dynamic pricing (synthetic → real)

- **Status:** `UPFRONT_DYNAMIC` synthetic pricing implemented, bounded [1.0,1.5], config-gated.
  Default `PRICING_MODE=REGULATED_METER_ESTIMATE` — **real charges stay regulated**; dynamic is
  synthetic/TEST only.
- **Activate for real:** set `PRICING_MODE=UPFRONT_DYNAMIC` **only** once a commercial dynamic-tariff
  rule is authorized (and ideally real weather, §4). Until then leave it regulated.

## 6. Production domain `il-y.taxi` DNS

- **Status:** nginx vhost + app (`APP_BASE_URL`, `APP_ALLOWED_HOSTS`) are ready; tracking links
  derive from the request host. `il-y.taxi` had **no public A record** as of the last check.
- **Activate:** point `il-y.taxi` (and `www`) at `92.39.53.229`. **Confirm Cloudflare-fronted**
  (self-signed origin cert is fine on "Full") vs direct origin (issue a real cert — Let's Encrypt
  `certbot --nginx -d il-y.taxi -d www.il-y.taxi`, needs DNS pointing here first, or Cloudflare
  Origin CA). `cyprustaxi.ackedberryes.store` keeps serving meanwhile.

## 7. Off-host backups / DR (RPO≤15m, RTO≤2h)

- **Status:** encrypted daily PG + uploads backups with a **measured, verified restore**
  (`deploy/backup.sh` + `deploy/restore-verify.sh`). `BACKUP_REMOTE` is unset → snapshots are
  same-disk and therefore **not disaster recovery**; daily cadence ≈24h RPO.
- **Activate:** set `BACKUP_REMOTE` to an off-host destination and add WAL/PITR for the ≤15m RPO.
  **Verify:** `deploy/backup.log` shows a successful off-host push; run `restore-verify.sh`.
- **Note (fixed 2026-10-01):** a fresh `prisma migrate deploy` now applies the full migration
  history cleanly from an empty database (previously broken by a migration-ordering quirk), so a
  new-environment / DR rebuild provisions the schema correctly.

## 8. Emailed receipts (new, Task 020 follow-on)

- **Status:** the in-app receipt (`/rides/[id]`) is delivered and built from the immutable Fare.
  The app has **no email transport** (SMS/OTP is phone-only). Emailing a receipt is therefore a
  future enablement, not a present gap in the receipt feature.
- **Activate:** add an email provider + transport (e.g. SMTP or a provider SDK) and the matching
  env, then send the existing receipt payload. Until then the in-app receipt stands on its own.

## Not an external blocker (environment limitation here)

- **Real on-phone journey** (device GPS + handset push delivery) and multi-device UI regression
  need a physical phone, which this environment lacks. The full dispatch→complete server flow and
  the browser UI are verified by other means (DB tests, headless Chromium, live server smoke); the
  on-device leg remains explicitly unverified.
