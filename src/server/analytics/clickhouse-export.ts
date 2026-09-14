// ClickHouse export path (Task 016 §6). Implemented fully in M3. Kept as a typed stub so the
// exporter compiles and the dedicated worker can call it; it only runs when CLICKHOUSE_URL is set.
export async function exportBatchToClickHouse(): Promise<{ claimed: number; delivered: number; failed: number }> {
  return { claimed: 0, delivered: 0, failed: 0 };
}
