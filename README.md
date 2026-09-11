# IL-Yas

> Product name: **IL-Yas**. The repository name, domain (`cyprustaxi.ackedberryes.store`), API paths, database names, cookies and secrets are intentionally unchanged — the rename is a visible rebrand only.

Web-first taxi booking and vehicle-tracking application. Dark charcoal UI with lime accents.
Passenger booking + secure tracking, dispatcher assignment + fleet map, driver foreground GPS,
admin, and a durable PostgreSQL backend. Built with Next.js 15 (App Router) + TypeScript + Prisma.

**Live beta:** https://cyprustaxi.ackedberryes.store — a clearly-labelled synthetic test service (`DEMO_MODE=true`). Do not enter real personal data. See [`docs/BETA_RELEASE.md`](docs/BETA_RELEASE.md).

## Run locally

```bash
npm install
cp .env.example .env                 # then fill DATABASE_URL + secrets (openssl rand -hex 32)
# start a Postgres, point DATABASE_URL at it, then:
npx prisma migrate deploy
npm run seed                         # synthetic demo staff/vehicles/bookings
ADMIN_LOGIN=admin ADMIN_PASSWORD='a-strong-password' npm run bootstrap:admin
npm run dev                          # http://localhost:3000
```

Tests: `npm test` (unit + DB-backed integration; needs a reachable Postgres via `.env`).

## Run with Docker (isolated stack)

```bash
cp .env.example deploy/.env.production   # set secrets + APP_HOST_PORT + POSTGRES_*
sudo docker compose --env-file deploy/.env.production up -d --build
# one-time: seed + admin bootstrap
sudo docker compose --env-file deploy/.env.production exec -e DEMO_PASSWORD=… taxi-app npm run seed
sudo docker compose --env-file deploy/.env.production exec -e ADMIN_LOGIN=admin -e ADMIN_PASSWORD=… taxi-app npm run bootstrap:admin
```

App listens on `127.0.0.1:${APP_HOST_PORT}`; put a reverse proxy in front for HTTPS. Migrations apply automatically on container start.

## Layout

- `src/app` — routes (public `/`, `/track`, `/staff/login`, `/dispatch`, `/driver`, `/admin/*`) and `/api/v1` handlers.
- `src/lib` — config, auth, tracking, status machine, geo, validation, http helpers.
- `src/server` — booking, assignment, location services and view serializers.
- `prisma` — schema, migrations, synthetic seed. `scripts/bootstrap-admin.ts` — one-time admin.
- `docs` — SPEC, DECISIONS, IMPLEMENTATION_STATUS, HANDOFF, TEST_REPORT, BETA_RELEASE.

Never commit secrets. `deploy/.env.production` and `deploy/secrets/` are git-ignored.
