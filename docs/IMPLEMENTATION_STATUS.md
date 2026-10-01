# Implementation status

**Current: release f998681 DEPLOYED + live-verified (2026-10-01). vitest 107 passed / 1 skipped
(CH integration) on an isolated pg16 `_test` DB; `tsc --noEmit` clean; `npm run build` compiles.**

**Migration DR fix (2026-10-01).** A fresh `prisma migrate deploy` from an empty database is now
clean — previously the Task 013/014/015 completion migration altered `ApplicationDocument` before
the KYC migration created it, so new-environment / DR / isolated-test provisioning failed in sorted
order (prod survived via incremental application). Guarded + an idempotent ensure-column migration
added; verified a fresh deploy applies all 15 migrations and prod applied only the 2 new ones with
no error. See HANDOFF (commit d3f1c65).

**Task 020 (post-trip rating + ride receipt) DONE + deployed — release f998681.** After a trip
COMPLETEs the owning passenger rates the driver 1-5 (+ optional tags/comment), one immutable rating
per booking; the driver who actually completed the trip is the one rated; the driver dashboard shows
an aggregate rating maintained in the same transaction. Passenger ride receipt (`/rides/[id]`) is
built from the immutable Fare and is honest under regulated metering (no fabricated total). No email
transport exists, so emailed receipts are a documented future enablement. Live-verified: schema +
routes present and correctly 401-gated on prod; business logic proven by `tests/ratings.db.test.ts`
(7) + `tests/receipt.db.test.ts` (3) on the same pg16 engine. See Tasks/020 + HANDOFF.

**Tasks 018 + 019 (consumer login/sign-up, account menu, saved places, full driver offer data) DONE
+ deployed.** Clean email+password `/login` + Bolt-style `/register`; signed-in header account menu
+ `/account` profile settings; saved places (Home/Work) with booking quick-picks; driver offer
returns the full fare breakdown + passenger block before accepting. Migrations
`20260914201355_t018_passenger_email_password`, `20260914225845_t019_saved_places`. See HANDOFF.

**Consolidated external enablement:** `docs/EXTERNAL-ENABLEMENT.md` lists every honest-gated
capability (real SMS, clamd AV, Places New, weather, dynamic pricing, il-y.taxi DNS, off-host
backups/DR, emailed receipts) with exact env vars + how to verify each lights up. None is faked.

**Task 017 (driver dashboard) DONE + deployed — release 53f42e4.** Four-section driver dashboard
(Home/Trips/Earnings/Profile) preserving the working offer/GPS/nav/arrive/start-code/complete/chat/
push flow, with the runtime kept above the tabs so switching sections never stops GPS/offers/the
ride. Server-timestamped duty sessions (online-time, feeds analytics), driver-reported settlement
separate from the immutable Fare (revision-appended, audited, completing-driver-only), financially
truthful earnings (known=recorded, unknown=pending, estimates never income, per-currency) + CSV.
Scoped driver APIs; privacy-safe trip history. Browser-QA'd at 390/320/1440 with a synthetic driver
since removed. vitest 93 passed / 1 skipped. See Tasks/017 completion matrix + HANDOFF.

**Task 016 (data platform) DONE + deployed — release 4a07f34.** PostgreSQL durable domain-event
capture (rollback-safe, in-transaction) + hardened notification outbox + GPS history; a dedicated
supervised worker process (one owner, cross-process heartbeat health); a private ClickHouse
analytics store (least-priv, `domain_events` ReplacingMergeTree, at-least-once exporter, backfill,
lag-aware reconciliation); an ADMIN `/admin/analytics` screen with honest metric definitions and a
pipeline-health panel; and encrypted daily backups with a **measured** restore. vitest 90 passed /
1 skipped (CH integration test passed vs the live container). Blockers (not faked): off-host backup
destination + WAL/PITR for RPO/RTO. See Tasks/016 completion matrix + docs/architecture/DATA-PLATFORM.md.

Updated 2026-09-14. Deployed publicly to https://cyprustaxi.ackedberryes.store, release **31d5781** (production domain il-y.taxi ready pending DNS). Autonomous ride-hailing beta: Task 012 (M0–M4) + Task 013 (P0 done, P1 mostly, P2 partial). Live driver↔passenger routes + marker animation, booking chat, and Web Push (chat, ride offers, assignment/arrival/no-driver/rematch/cancellation). **vitest 78/78. Tasks 013 (notification outbox + atomic chat auth) + 014 (passenger accounts, mandatory login, My rides, destination history) + 015 completion (malware-scan gate, expiry enforcement, concurrency-safe review, autosave) done except two HARD external blockers — real SMS (needs Twilio Account SID/Auth Token) and real malware scanning (needs a clamd host); both implemented+gated, never faked. Task 015 (driver self-registration + KYC + admin approval + eligibility gate) IMPLEMENTED + deployed — see Tasks/015 + HANDOFF.**

**Live verification (2026-09-14):** an automated server-side smoke of the full no-dispatcher journey PASSED on prod (book → worker offer → accept → EN_ROUTE → arrive → coded start → complete → immutable receipt; capacity freed), run via the real API with a dedicated synthetic driver that was created for the test and then removed. Driver GPS was DB test-scaffolding, so this proves the dispatch/lifecycle/receipt server flow live — NOT on-device GPS or handset push delivery (still to be checked on a real phone). Details in docs/HANDOFF.md; per-item status in Tasks/013 (completion matrix).

Remaining (documented next actions): **HARD external blockers** — real SMS (Twilio Account SID + Auth Token) and real malware scanning (a clamd host); both are implemented+gated and never faked. Minor/optional: ETA source-exposure in the passenger UI; legacy-driver review queue (retire LEGACY); optional email verification; real on-phone browser journeys (device GPS + push). External enablement: Places API (New); a commercial weather provider; any dynamic-tariff authorization. DONE this pass: notification outbox, atomic chat auth, passenger accounts/mandatory login/My rides/destination history, malware-scan gate, document-expiry enforcement + reminders, concurrency-safe review, wizard autosave. (013 scheduled-time pricing + chat pagination also DONE.)

| Milestone | Status | Evidence / next action |
|---|---|---|
| 1. Repository inspection and skeleton | DONE | Next.js 15 + TS + Prisma + Tailwind scaffolded; env inspected (host 92.39.53.229, nginx proxy, other vhosts preserved). |
| 2. Database, auth and domain logic | DONE | Prisma schema + migration `20260910214335_init`; bcrypt sessions; status machine; DB `active*` uniqueness; 12/12 tests. |
| 3. Passenger booking and tracking | DONE | Booking API (idempotent) + scoped tracking; responsive dark/lime booking + tracking UIs; E2E verified. |
| 4. Dispatcher and admin | DONE | Queue + fleet map, assign/reassign/unassign/terminate; admin drivers/vehicles/bindings/settings. |
| 5. Driver GPS and complete trip | DONE | Driver app with real foreground watchPosition; ingestion validation; full trip completion verified. |
| 6. Demo, PWA, failure states, polish | DONE | DEMO banner, MapLibre + fallback, reconnect/stale states, PWA manifest/icons, CSP middleware. |
| 7. Tests, QA and deployment assets | DONE | vitest (unit+DB), curl E2E, auth boundaries; Dockerfile + Compose + seed + bootstrap + .env.example. |
| 8. Isolated beta deployment | DONE | Compose stack live; nginx vhost; public HTTPS smoke + restart persistence verified. See docs/BETA_RELEASE.md. |

Pending (explicitly not represented as verified): physical-device GPS, staging load test, production map/geocoder/router provider.
