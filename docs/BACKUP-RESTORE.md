# Backup & restore runbook (Task 016 §9)

## What is backed up
- **PostgreSQL** — the authoritative store (bookings, assignments, Fare, auth, KYC metadata,
  domain events). Logical `pg_dump -Fc`, AES-256 encrypted.
- **Private uploads** — KYC document bytes on the `taxicy_uploads` volume, tar + AES-256.
- **ClickHouse** — DDL snapshot only. The analytics data is rebuildable by re-export from Postgres
  domain events (retained ≥ 14 days), so a full analytics dump is unnecessary for the beta.

## Scripts
- `deploy/backup.sh` — creates encrypted snapshots in `deploy/backups/`, keeps the last
  `BACKUP_KEEP` (default 14), and syncs off-host if `BACKUP_REMOTE` is set.
- `deploy/restore-verify.sh` — restores the latest PG dump into an **isolated** `taxi_restore_check`
  database on the pg16 server, validates migrations/counts/FK integrity, and drops it.

Passphrase: `deploy/secrets/backup.pass` (gitignored, `chmod 600`). **Losing it makes backups
unrecoverable** — store a copy in a secrets manager.

## Automation
A root cron runs `backup.sh` daily at **03:30 UTC** → `deploy/backups/backup.log`:
```
30 3 * * * BACKUP_DIR=.../deploy/backups BACKUP_PASSPHRASE_FILE=.../deploy/secrets/backup.pass /bin/sh .../deploy/backup.sh >> .../deploy/backups/backup.log 2>&1 # taxi-backup
```

## Restore procedure (measured)
```
sudo BACKUP_PASSPHRASE_FILE=.../deploy/secrets/backup.pass sh deploy/restore-verify.sh
```
Verified 2026-09-14 against `pg-20260914T165343Z.dump.enc`: 10 migrations, 18 bookings, 5 drivers,
1 fare, 0 orphan assignments → **restore verified**. Note the dump is pg16 (archive v1.15); restore
with pg16 tools (the script restores inside the `taxicy-db` container) — the host's pg12 client
cannot read it.

### Full production restore (disaster)
1. Stop `taxi-app` + `taxi-worker`.
2. Decrypt the latest `pg-*.dump.enc`, `docker cp` into `taxicy-db`, `pg_restore` into a fresh
   `taxi_cyprus` (or a new volume), matching pg16.
3. Restore `uploads-*.tar.gz.enc` into the `taxicy_uploads` volume. **PG metadata and upload bytes
   must be from the same/adjacent snapshot** — if they diverge, reconcile by `storageKey` (drop
   `ApplicationDocument` rows whose bytes are missing).
4. Start `taxi-app` (runs `prisma migrate deploy`), then `taxi-worker`.
5. Rebuild ClickHouse if needed (see `PIPELINE-OPERATIONS.md` → *Rebuild ClickHouse*).

## RPO / RTO
Targets: **RPO ≤ 15 min**, **RTO ≤ 2 h**. These are **not yet achieved** at the current cadence:
daily backups give an effective RPO of ~24 h. To reach the target, enable PostgreSQL WAL archiving /
PITR (`archive_command` to an off-host store) and shorten the schedule. Do not claim the target
until a timed full restore proves it.

## Open blocker (honest)
**No off-host destination is configured** (`BACKUP_REMOTE` unset). Same-disk snapshots are **not**
disaster recovery — a host-loss event loses them. Provide an authorized off-host destination
(object storage / remote host) and set `BACKUP_REMOTE`; the sync path in `backup.sh` is ready.
