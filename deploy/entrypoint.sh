#!/bin/sh
set -e

# Only ONE process owns schema migrations. In dedicated-worker mode the web app runs them and
# the worker waits for the schema to be ready; RUN_MIGRATIONS=off skips them entirely.
if [ "${RUN_MIGRATIONS}" = "off" ]; then
  echo "[entrypoint] RUN_MIGRATIONS=off — waiting for schema to be ready (migrations owned by another service)…"
  # Wait until the _prisma_migrations table exists so the worker doesn't start against a bare DB.
  i=0
  until npx prisma migrate status >/dev/null 2>&1 || [ "$i" -ge 30 ]; do
    i=$((i+1)); sleep 2
  done
else
  echo "[entrypoint] Applying database migrations…"
  npx prisma migrate deploy
fi

echo "[entrypoint] Starting IL-Y (${WORKER_ROLE:-web}) on :3000"
exec npm run start
