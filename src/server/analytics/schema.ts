// ClickHouse analytical schema (Task 016 §6). The single authoritative table is `domain_events`
// — an immutable, sanitized projection of Postgres DomainEvent. Delivery is at-least-once, so:
//   - the engine is ReplacingMergeTree and the sort key ends in eventId → duplicate inserts of the
//     same event collapse to one row on merge;
//   - canonical analytics queries (see queries.ts) never sum raw rows blindly — they dedup by
//     eventId and take argMax(...) by aggregateVersion, so correctness holds BEFORE any merge and
//     a replayed batch cannot change counts or money.
// PARTITION BY month of occurredAt: an event's occurredAt is immutable, so retries land in the
// same partition; booking versions are reduced by query (not stored per-version), so there is no
// cross-partition convergence problem for a booking that spans a month boundary.

export const CH_SCHEMA_VERSION = 1;

export function ddlStatements(db: string): string[] {
  return [
    `CREATE DATABASE IF NOT EXISTS ${db}`,
    `CREATE TABLE IF NOT EXISTS ${db}.domain_events
     (
       eventId          String,
       eventType        LowCardinality(String),
       schemaVersion    UInt16,
       aggregateType    LowCardinality(String),
       aggregateId      String,
       aggregateVersion UInt32,
       eventOrdinal     UInt16,
       occurredAt       DateTime64(3, 'UTC'),
       recordedAt       DateTime64(3, 'UTC'),
       environment      LowCardinality(String),
       isTest           UInt8,
       correlationId    String,
       causationId      String,
       payload          String,
       exportedAt       DateTime64(3, 'UTC') DEFAULT now64(3)
     )
     ENGINE = ReplacingMergeTree(recordedAt)
     PARTITION BY toYYYYMM(occurredAt)
     ORDER BY (eventType, aggregateId, eventId)
     SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS ${db}.ch_schema_version
     (version UInt32, appliedAt DateTime DEFAULT now())
     ENGINE = TinyLog`,
  ];
}
