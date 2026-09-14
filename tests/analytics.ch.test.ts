import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

// ClickHouse integration test (Task 016 §10). Skipped unless CLICKHOUSE_URL is set, so the normal
// local suite is unaffected; run against a real ClickHouse to exercise the export path + dedup.
const HAS_CH = !!process.env.CLICKHOUSE_URL;

describe.skipIf(!HAS_CH)('ClickHouse export pipeline (integration)', () => {
  it('ensures schema, exports a claimed event, and a replay does NOT change the count', async () => {
    const { ensureClickHouseSchema, exportBatchToClickHouse } = await import('@/server/analytics/clickhouse-export');
    const { chSelect, chInsert, chDateTime } = await import('@/server/analytics/clickhouse');
    const { prisma } = await import('@/lib/db');
    const { recordEvent } = await import('@/server/events');
    const db = process.env.CLICKHOUSE_DB || 'taxi_analytics';

    await ensureClickHouseSchema();
    const id = randomUUID();
    await prisma.$transaction((tx) => recordEvent(tx, { eventType: 'test.ch', aggregateType: 'test', aggregateId: id, aggregateVersion: 1, payload: { n: 1 } }));

    // Drain until our delivery is DELIVERED (other pending rows may share the batch).
    for (let i = 0; i < 10; i++) {
      const d = await prisma.analyticsDelivery.findFirst({ where: { event: { aggregateType: 'test', aggregateId: id } } });
      if (d?.status === 'DELIVERED') break;
      await exportBatchToClickHouse();
    }
    const del = await prisma.analyticsDelivery.findFirst({ where: { event: { aggregateType: 'test', aggregateId: id } } });
    expect(del?.status).toBe('DELIVERED');

    const count = async () => Number((await chSelect<{ c: string }>(`SELECT count(DISTINCT eventId) AS c FROM ${db}.domain_events WHERE aggregateId = '${id}'`, { asWrite: true }))[0]?.c ?? 0);
    expect(await count()).toBe(1);

    // Replay the SAME event (simulate crash-after-insert): count must stay 1 (ReplacingMergeTree
    // + count(DISTINCT eventId) make at-least-once delivery idempotent for analytics).
    const ev = (await prisma.domainEvent.findFirst({ where: { aggregateType: 'test', aggregateId: id } }))!;
    await chInsert('domain_events', [{
      eventId: ev.id, eventType: ev.eventType, schemaVersion: ev.schemaVersion, aggregateType: ev.aggregateType,
      aggregateId: ev.aggregateId, aggregateVersion: ev.aggregateVersion, eventOrdinal: ev.eventOrdinal,
      occurredAt: chDateTime(ev.occurredAt), recordedAt: chDateTime(ev.recordedAt), environment: ev.environment,
      isTest: ev.isTest ? 1 : 0, correlationId: '', causationId: '', payload: JSON.stringify(ev.payload),
    }]);
    expect(await count()).toBe(1);
  });
});
