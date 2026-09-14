import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { chSelect, chPing } from './clickhouse';

// Pipeline health + reconciliation (Task 016 §7/§8). Reconciliation here is one-directional and
// lag-aware: ClickHouse should hold AT LEAST as many distinct events as Postgres has marked
// DELIVERED (it may hold more, from replays/backfill). chEvents < pgDelivered is a real gap;
// a positive backlog is normal lag, not a mismatch. We never claim consistency by comparing a
// changing Postgres total against a delayed ClickHouse total without accounting for that.

export interface PipelineStatus {
  enabled: boolean;
  clickhouseReachable: boolean;
  backlog: { pending: number; retry: number; processing: number; dead: number; delivered: number };
  oldestPendingAgeMs: number | null;
  pgDelivered: number;
  chDistinctEvents: number | null;
  gap: number | null; // pgDelivered - chDistinctEvents; > 0 means events acked in PG but missing in CH
  consistent: boolean | null;
}

export async function pipelineStatus(now: Date = new Date()): Promise<PipelineStatus> {
  const grouped = await prisma.analyticsDelivery.groupBy({ by: ['status'], where: { sink: 'clickhouse' }, _count: { _all: true } });
  const g: Record<string, number> = {};
  for (const row of grouped) g[row.status] = row._count._all;

  const oldest = await prisma.analyticsDelivery.findFirst({
    where: { sink: 'clickhouse', status: { in: ['PENDING', 'RETRY'] } },
    orderBy: { nextAttemptAt: 'asc' }, select: { createdAt: true },
  });
  const pgDelivered = g['DELIVERED'] ?? 0;

  let chDistinctEvents: number | null = null;
  let reachable = false;
  if (config.analytics.enabled && (await chPing())) {
    reachable = true;
    try {
      const rows = await chSelect<{ c: string }>(`SELECT count(DISTINCT eventId) AS c FROM ${config.analytics.db}.domain_events`, { asWrite: true });
      chDistinctEvents = Number(rows[0]?.c ?? 0);
    } catch { chDistinctEvents = null; }
  }

  const gap = chDistinctEvents == null ? null : Math.max(0, pgDelivered - chDistinctEvents);
  return {
    enabled: config.analytics.enabled,
    clickhouseReachable: reachable,
    backlog: { pending: g['PENDING'] ?? 0, retry: g['RETRY'] ?? 0, processing: g['PROCESSING'] ?? 0, dead: g['DEAD'] ?? 0, delivered: pgDelivered },
    oldestPendingAgeMs: oldest ? now.getTime() - oldest.createdAt.getTime() : null,
    pgDelivered,
    chDistinctEvents,
    gap,
    consistent: gap == null ? null : gap === 0,
  };
}
