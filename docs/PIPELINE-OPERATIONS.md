# Analytics pipeline operations (Task 016)

## Components
- **Producer:** every domain mutation writes a `DomainEvent` + `AnalyticsDelivery(clickhouse,
  PENDING)` in its transaction.
- **Exporter:** the worker's analytics section (`exportBatchToClickHouse`) claims PENDING/RETRY
  deliveries with a lease (`FOR UPDATE SKIP LOCKED`), inserts events into ClickHouse
  `domain_events`, and acks rows whose lease token still matches. Backoff → `DEAD` after 8 attempts.
- **Reader:** `/admin/analytics` (ADMIN) queries via the read-only ClickHouse user.

## Health & monitoring
- `GET /api/v1/health/live` — `mode`, `dispatch.alive` (from `WorkerHeartbeat`, cross-process),
  `analytics.alive`, per-role heartbeat ages.
- `/admin/analytics` pipeline panel — backlog (pending/retry/processing/**dead**/exported), oldest
  pending age, ClickHouse distinct events, reconciliation (`gap`).
- **Alert** when: `dead > 0`, oldest pending age keeps growing, or `dispatch.alive=false`.

## Reconciliation
`pipelineStatus()` compares Postgres `DELIVERED` count with ClickHouse `count(DISTINCT eventId)`.
It is **one-directional and lag-aware**: CH must hold **≥** the delivered count (it may hold more,
from replays/backfill). A positive backlog is normal lag, not a mismatch; `gap > 0` (CH behind acked
PG) is a real problem to investigate.

## Common operations

**Bootstrap / re-create the ClickHouse schema** (idempotent):
```
POST /api/v1/admin/analytics/bootstrap        # ADMIN; ensures schema
```

**Backfill pre-event bookings** (reconstructed snapshots, flagged `reconstructed:true`):
```
POST /api/v1/admin/analytics/bootstrap {"backfill": true, "batch": 200}
# repeat passing {"afterCreatedAt": "<last cursor>"} until backfill.done == true
```

**Drain a backlog manually:** the worker drains every tick; if stuck, check the worker is alive and
ClickHouse is reachable (`docker exec taxicy-clickhouse clickhouse client -q "SELECT 1"`).

**Reset a stuck DEAD delivery** after fixing the cause:
```
UPDATE "AnalyticsDelivery" SET status='PENDING', "nextAttemptAt"=now(), attempts=0
WHERE sink='clickhouse' AND status='DEAD';
```

**Rebuild ClickHouse from scratch** (data loss in CH only; Postgres is the source of truth):
```
TRUNCATE TABLE taxi_analytics.domain_events;                       -- in clickhouse client
UPDATE "AnalyticsDelivery" SET status='PENDING', "deliveredAt"=null, "nextAttemptAt"=now()
WHERE sink='clickhouse';                                            -- re-queue everything still in PG
-- the worker re-exports; events pruned from PG past the safety window are gone from PG and must be
-- restored from a ClickHouse/Postgres backup if a full history is required.
```

## Safety notes
- The ClickHouse **integration test drains the whole local `AnalyticsDelivery` backlog** into the
  configured CH database. It refuses to run unless `CLICKHOUSE_DB` ends in `_test` — **never point
  it at production `taxi_analytics`** (doing so leaks local test events into prod CH).
- ClickHouse holds only sanitized, pseudonymous data. Exact GPS coordinates are restricted — keep
  them out of general admin charts/exports.
- Test/synthetic data is excluded from analytics by default; the reader can opt in with a toggle.
