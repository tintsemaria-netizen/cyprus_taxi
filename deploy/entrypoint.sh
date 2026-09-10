#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations…"
npx prisma migrate deploy

echo "[entrypoint] Starting Taxi Cyprus on :3000"
exec npm run start
