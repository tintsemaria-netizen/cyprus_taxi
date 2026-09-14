import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { chExec, chInsert, chDateTime } from './clickhouse';
import { ddlStatements, CH_SCHEMA_VERSION } from './schema';

// ClickHouse exporter (Task 016 §6/§7). Claims PENDING/RETRY AnalyticsDelivery rows with a lease
// (FOR UPDATE SKIP LOCKED — safe with N exporters), inserts the referenced domain events into
// ClickHouse (at-least-once; the engine dedups by eventId), then acknowledges only rows whose
// lease token still matches. A crash after the CH insert but before the ack simply replays the
// same events — ReplacingMergeTree + dedup queries make that a no-op for counts and money.

const LEASE_MS = 60_000;
const BACKOFF_SEC = [5, 15, 60, 300, 900];
const MAX_ATTEMPTS = 8;

let schemaReady = false;

// Idempotent schema bootstrap — separate from web startup (only the worker's analytics section
// or an explicit admin action calls the exporter). CREATE ... IF NOT EXISTS, safe to repeat.
export async function ensureClickHouseSchema(): Promise<void> {
  for (const stmt of ddlStatements(config.analytics.db)) await chExec(stmt);
  await chExec(`INSERT INTO ${config.analytics.db}.ch_schema_version (version) SELECT ${CH_SCHEMA_VERSION} WHERE (SELECT count() FROM ${config.analytics.db}.ch_schema_version WHERE version = ${CH_SCHEMA_VERSION}) = 0`);
  schemaReady = true;
}

interface ClaimRow { id: string; eventId: string; attempts: number }

export async function exportBatchToClickHouse(): Promise<{ claimed: number; delivered: number; failed: number }> {
  if (!schemaReady) await ensureClickHouseSchema();

  const owner = `chexp-${process.pid}`;
  const token = randomUUID();
  const now = new Date();

  // Reclaim leases from a crashed exporter.
  await prisma.analyticsDelivery.updateMany({
    where: { sink: 'clickhouse', status: 'PROCESSING', leaseUntil: { lt: now } },
    data: { status: 'RETRY', nextAttemptAt: now, leaseOwner: null, leaseToken: null, leaseUntil: null },
  });

  const claimed = await prisma.$queryRaw<ClaimRow[]>`
    UPDATE "AnalyticsDelivery" AS d
    SET status = 'PROCESSING', "leaseOwner" = ${owner}, "leaseToken" = ${token},
        "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = now()
    WHERE d.id IN (
      SELECT id FROM "AnalyticsDelivery"
      WHERE sink = 'clickhouse' AND status IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${config.analytics.exportBatch}
    )
    RETURNING d.id, d."eventId", d.attempts`;

  if (claimed.length === 0) return { claimed: 0, delivered: 0, failed: 0 };

  const events = await prisma.domainEvent.findMany({ where: { id: { in: claimed.map((c) => c.eventId) } } });
  try {
    await chInsert('domain_events', events.map(toRow));
    await prisma.analyticsDelivery.updateMany({
      where: { id: { in: claimed.map((c) => c.id) }, leaseToken: token },
      data: { status: 'DELIVERED', deliveredAt: new Date(), leaseOwner: null, leaseToken: null, leaseUntil: null, lastError: null },
    });
    return { claimed: claimed.length, delivered: events.length, failed: 0 };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    for (const c of claimed) {
      const attempts = c.attempts + 1;
      const backoff = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000;
      await prisma.analyticsDelivery.updateMany({
        where: { id: c.id, leaseToken: token },
        data: attempts >= MAX_ATTEMPTS
          ? { status: 'DEAD', attempts, lastError: msg, leaseOwner: null, leaseToken: null, leaseUntil: null }
          : { status: 'RETRY', attempts, nextAttemptAt: new Date(now.getTime() + backoff), lastError: msg, leaseOwner: null, leaseToken: null, leaseUntil: null },
      });
    }
    return { claimed: claimed.length, delivered: 0, failed: claimed.length };
  }
}

function toRow(e: {
  id: string; eventType: string; schemaVersion: number; aggregateType: string; aggregateId: string;
  aggregateVersion: number; eventOrdinal: number; occurredAt: Date; recordedAt: Date; environment: string;
  isTest: boolean; correlationId: string | null; causationId: string | null; payload: unknown;
}): Record<string, unknown> {
  return {
    eventId: e.id,
    eventType: e.eventType,
    schemaVersion: e.schemaVersion,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    aggregateVersion: e.aggregateVersion,
    eventOrdinal: e.eventOrdinal,
    occurredAt: chDateTime(e.occurredAt),
    recordedAt: chDateTime(e.recordedAt),
    environment: e.environment,
    isTest: e.isTest ? 1 : 0,
    correlationId: e.correlationId ?? '',
    causationId: e.causationId ?? '',
    payload: JSON.stringify(e.payload),
  };
}
