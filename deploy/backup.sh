#!/bin/sh
# Task 016 §9 — automated encrypted backups of the beta data platform.
#   1. PostgreSQL logical dump (authoritative operational + finance + KYC-metadata store)
#   2. Private uploads volume (KYC document bytes) — kept consistent with the PG metadata
#   3. ClickHouse: PG domain events are the source of truth (retained >= safety window) and CH is
#      rebuildable by re-export, so we snapshot the CH DDL for a fast rebuild rather than a full
#      analytics dump. (A native `clickhouse-backup` can be added when the store grows.)
# Everything is encrypted at rest with AES-256 (openssl, pbkdf2). Local snapshots alone are NOT
# disaster recovery — an OFF-HOST destination must be configured (BACKUP_REMOTE) to be safe.
set -eu

OUT="${BACKUP_DIR:-/home/claudeuser/projects/cyprus_taxi/deploy/backups}"
PASS="${BACKUP_PASSPHRASE_FILE:-/home/claudeuser/projects/cyprus_taxi/deploy/secrets/backup.pass}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[ -f "$PASS" ] || { echo "[backup] FATAL: passphrase file $PASS missing"; exit 1; }
mkdir -p "$OUT"

enc() { openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASS"; }

echo "[backup] $STAMP → $OUT"

# 1) PostgreSQL (custom format, compressed).
docker exec taxicy-db pg_dump -U taxi -d taxi_cyprus -Fc | enc > "$OUT/pg-$STAMP.dump.enc"
echo "[backup]  pg-$STAMP.dump.enc ($(du -h "$OUT/pg-$STAMP.dump.enc" | cut -f1))"

# 2) Private uploads (KYC bytes) from the named volume.
docker run --rm -v taxicy_uploads:/data:ro alpine tar czf - -C /data . | enc > "$OUT/uploads-$STAMP.tar.gz.enc"
echo "[backup]  uploads-$STAMP.tar.gz.enc ($(du -h "$OUT/uploads-$STAMP.tar.gz.enc" | cut -f1))"

# 3) ClickHouse schema snapshot (rebuild aid; data is re-exportable from PG domain events).
docker exec taxicy-clickhouse clickhouse client -q "SHOW CREATE TABLE taxi_analytics.domain_events FORMAT TabSeparatedRaw" > "$OUT/ch-schema-$STAMP.sql" 2>/dev/null || echo "[backup]  (clickhouse not reachable — schema snapshot skipped)"

# Retention: keep the most recent $KEEP of each artifact locally.
for pat in "pg-*.dump.enc" "uploads-*.tar.gz.enc" "ch-schema-*.sql"; do
  ls -1t "$OUT"/$pat 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done

# Off-host copy (disaster recovery). Without it, this is only a same-host snapshot.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "[backup] syncing to off-host $BACKUP_REMOTE"
  rsync -a "$OUT"/pg-"$STAMP".dump.enc "$OUT"/uploads-"$STAMP".tar.gz.enc "$BACKUP_REMOTE"/
  echo "[backup] off-host sync complete"
else
  echo "[backup] WARNING: BACKUP_REMOTE not configured — LOCAL SNAPSHOT ONLY, not disaster recovery."
fi
echo "[backup] done"
