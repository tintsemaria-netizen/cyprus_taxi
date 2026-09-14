import { config } from '@/lib/config';

// Analytics exporter (Task 016 §6). Claims AnalyticsDelivery rows and projects the referenced
// domain events into ClickHouse at-least-once. The real ClickHouse insert is wired in M3; until
// a sink is configured this is a no-op so delivery rows accumulate as a durable Postgres spool
// (they are NEVER dropped un-exported). Analytics being down or absent must never affect
// operations — this runs only in the dedicated worker's analytics section.
export async function drainAnalytics(_now: Date = new Date()): Promise<{ claimed: number; delivered: number; failed: number }> {
  if (!config.analytics.enabled) return { claimed: 0, delivered: 0, failed: 0 };
  const { exportBatchToClickHouse } = await import('./clickhouse-export');
  return exportBatchToClickHouse();
}
