# Implementation status

Updated 2026-09-14. Deployed publicly to https://cyprustaxi.ackedberryes.store, release **21868e1** (production domain il-y.taxi ready pending DNS). Autonomous ride-hailing beta: Task 012 (M0–M4) + Task 013 (P0 done, P1 mostly, P2 partial). Live driver↔passenger routes + marker animation, booking chat, and Web Push (chat, ride offers, assignment/arrival/no-driver/rematch/cancellation). **vitest 75/75. Task 015 (driver self-registration + KYC + admin approval + eligibility gate) IMPLEMENTED + deployed — see Tasks/015 + HANDOFF.**

**Live verification (2026-09-14):** an automated server-side smoke of the full no-dispatcher journey PASSED on prod (book → worker offer → accept → EN_ROUTE → arrive → coded start → complete → immutable receipt; capacity freed), run via the real API with a dedicated synthetic driver that was created for the test and then removed. Driver GPS was DB test-scaffolding, so this proves the dispatch/lifecycle/receipt server flow live — NOT on-device GPS or handset push delivery (still to be checked on a real phone). Details in docs/HANDOFF.md; per-item status in Tasks/013 (completion matrix).

Remaining (documented next actions): scheduled-time quote pricing (pricingAt/departureAt + bind schedule to quote hash), full ETA source-exposure in the passenger UI, chat cursor pagination, notification outbox, and a real on-phone browser journey (device GPS + push). External enablement: Places API (New); a commercial weather provider; any dynamic-tariff authorization.

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
