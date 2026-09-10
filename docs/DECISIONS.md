# Initial decisions and assumptions

- Approved visual direction: dark graphite/lime.
- Operator-managed fleet and manual dispatch assumed for beta; operator model was not explicitly confirmed.
- Guest passenger booking, unverified phone, payment to driver.
- English beta; Europe/Nicosia display time, UTC storage, EUR when relevant.
- Foreground browser GPS only; no background-location guarantee.
- Adapt existing stack if present; default TypeScript/React/Next.js/PostgreSQL. Implementation must verify compatible releases.
- Default bounded polling; live integrations configurable and demo unmistakable.
- Native Android/iOS clients deferred, API designed for reuse.
- Beta hosting confirmed by user: 92.39.53.229 / cyprustaxi.ackedberryes.store. Verify actual access and DNS. Map credentials and operator business information remain to be configured.

Append implementation decisions with date, alternatives, chosen option and reason.

## 2026-09-11 implementation decisions

- **Stack:** Next.js 15.5 (App Router) + TypeScript + Prisma + PostgreSQL 16 + Tailwind. Single service (UI + `/api/v1`). Chosen for one-deployable simplicity per SPEC §7; alternative split front/back rejected as unnecessary for beta. Next pinned to 15.5.25 (patched; 15.1.3 had CVE-2025-66478).
- **Active-assignment uniqueness:** modelled with nullable-unique `active*` columns on Assignment/Binding (NULL when ended) instead of Postgres partial indexes, because Prisma schema can express it directly while giving the same DB-level guarantee. Verified by a concurrent-assign test.
- **Maps:** real MapLibre GL renderer + OSM raster demo tiles (attribution shown). Geocoder/router are demo fixtures (no provider key). Straight-line ETA is labelled an estimate; no fake road route drawn (SPEC §9).
- **Tracking auth:** 256-bit token, digest-only storage, fragment→POST exchange to an HttpOnly booking-scoped cookie; token stripped from the URL client-side; `no-store`/`no-referrer` on private responses.
- **Deployment:** isolated Docker Compose (`taxicy`) with no public DB port; app on 127.0.0.1:8097; nginx vhost for the single hostname; self-signed origin cert under Cloudflare "Full". Chosen to preserve all other vhosts and avoid touching shared infra.
- **DEMO_MODE=true** for the beta with a conspicuous banner and synthetic seed; real integrations and DEMO_MODE=false deferred to operator configuration.
