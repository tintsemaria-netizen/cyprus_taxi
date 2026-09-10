# Implementation status

Updated 2026-09-11. Deployed publicly to https://cyprustaxi.ackedberryes.store.

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
