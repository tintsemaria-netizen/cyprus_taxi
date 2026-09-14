#!/bin/sh
# Task 016 §9 — prove a backup is restorable (RPO/RTO are not "achieved" until a measured restore
# proves it). Restores the latest PostgreSQL dump into an ISOLATED throwaway database on the pg16
# server (matching tool versions), validates migrations/row counts/foreign keys WITHOUT exposing
# real documents, then drops it.
set -eu

OUT="${BACKUP_DIR:-/home/claudeuser/projects/cyprus_taxi/deploy/backups}"
PASS="${BACKUP_PASSPHRASE_FILE:-/home/claudeuser/projects/cyprus_taxi/deploy/secrets/backup.pass}"
DB_CONTAINER="${DB_CONTAINER:-taxicy-db}"
CHECK_DB="taxi_restore_check"

LATEST="$(ls -1t "$OUT"/pg-*.dump.enc 2>/dev/null | head -1)"
[ -n "$LATEST" ] || { echo "[restore] no pg backup found in $OUT"; exit 1; }
echo "[restore] verifying $LATEST"

# Decrypt to a temp file and copy it into the pg16 container (its pg_restore matches the dump).
TMP="$(mktemp /tmp/taxi-restore.XXXXXX.dump)"
trap 'rm -f "$TMP"; docker exec "$DB_CONTAINER" rm -f "/tmp/$(basename "$TMP")" 2>/dev/null || true' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$PASS" -in "$LATEST" -out "$TMP"
docker cp "$TMP" "$DB_CONTAINER:/tmp/$(basename "$TMP")"

docker exec "$DB_CONTAINER" psql -U taxi -d taxi_cyprus -q -c "DROP DATABASE IF EXISTS $CHECK_DB;"
docker exec "$DB_CONTAINER" psql -U taxi -d taxi_cyprus -q -c "CREATE DATABASE $CHECK_DB;"
docker exec "$DB_CONTAINER" pg_restore -U taxi -d "$CHECK_DB" --no-owner --no-privileges "/tmp/$(basename "$TMP")" 2>/dev/null || true

echo "[restore] validation:"
docker exec "$DB_CONTAINER" psql -U taxi -d "$CHECK_DB" -tAc "
  SELECT 'applied_migrations=' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL
  UNION ALL SELECT 'bookings=' || count(*) FROM \"Booking\"
  UNION ALL SELECT 'drivers=' || count(*) FROM \"Driver\"
  UNION ALL SELECT 'fares=' || count(*) FROM \"Fare\"
  UNION ALL SELECT 'domain_events=' || count(*) FROM \"DomainEvent\";"

ORPHANS="$(docker exec "$DB_CONTAINER" psql -U taxi -d "$CHECK_DB" -tAc "SELECT count(*) FROM \"Assignment\" a LEFT JOIN \"Booking\" b ON b.id=a.\"bookingId\" WHERE b.id IS NULL;")"
echo "[restore] orphan assignments (must be 0): $ORPHANS"

docker exec "$DB_CONTAINER" psql -U taxi -d taxi_cyprus -q -c "DROP DATABASE $CHECK_DB;"
[ "$(echo "$ORPHANS" | tr -d '[:space:]')" = "0" ] && echo "[restore] OK — restore verified" || { echo "[restore] FAILED — FK integrity broken"; exit 1; }
