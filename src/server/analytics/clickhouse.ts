import { config } from '@/lib/config';

// Minimal ClickHouse HTTP client (Task 016 §6). Uses the HTTP interface on the PRIVATE docker
// network — no external host, no credentials in the browser. Write user for DDL/INSERT, strict
// read-only user for SELECT. Every call is time-bounded so a slow/hung ClickHouse never blocks
// the worker or an admin request.

function basic(user: string, pw: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pw}`).toString('base64');
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fn(ac.signal); } finally { clearTimeout(t); }
}

// Execute a statement (DDL / INSERT ... VALUES) as the WRITE user.
export async function chExec(sql: string, timeoutMs = 15_000): Promise<void> {
  await withTimeout(async (signal) => {
    const res = await fetch(`${config.analytics.url}/`, {
      method: 'POST',
      headers: { Authorization: basic(config.analytics.writeUser, config.analytics.writePassword()), 'Content-Type': 'text/plain' },
      body: sql,
      signal,
    });
    if (!res.ok) throw new Error(`ClickHouse exec ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }, timeoutMs);
}

// Insert rows as JSONEachRow (WRITE user). Rows are plain objects matching column names.
export async function chInsert(table: string, rows: Record<string, unknown>[], timeoutMs = 30_000): Promise<void> {
  if (rows.length === 0) return;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  const q = encodeURIComponent(`INSERT INTO ${config.analytics.db}.${table} FORMAT JSONEachRow`);
  await withTimeout(async (signal) => {
    const res = await fetch(`${config.analytics.url}/?query=${q}`, {
      method: 'POST',
      headers: { Authorization: basic(config.analytics.writeUser, config.analytics.writePassword()), 'Content-Type': 'application/x-ndjson' },
      body,
      signal,
    });
    if (!res.ok) throw new Error(`ClickHouse insert ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }, timeoutMs);
}

// Run a SELECT as the READ-ONLY user (default) and return parsed rows. `asWrite` is used only by
// reconciliation utilities that must read with the write user during bootstrap.
export async function chSelect<T = Record<string, unknown>>(sql: string, opts?: { asWrite?: boolean }, timeoutMs = 20_000): Promise<T[]> {
  const user = opts?.asWrite ? config.analytics.writeUser : config.analytics.readUser;
  const pw = opts?.asWrite ? config.analytics.writePassword() : config.analytics.readPassword();
  return withTimeout(async (signal) => {
    const res = await fetch(`${config.analytics.url}/?database=${encodeURIComponent(config.analytics.db)}&default_format=JSON`, {
      method: 'POST',
      headers: { Authorization: basic(user, pw), 'Content-Type': 'text/plain' },
      body: sql,
      signal,
    });
    if (!res.ok) throw new Error(`ClickHouse select ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = JSON.parse(await res.text()) as { data: T[] };
    return json.data ?? [];
  }, timeoutMs);
}

export async function chPing(timeoutMs = 5_000): Promise<boolean> {
  try {
    await withTimeout(async (signal) => {
      const res = await fetch(`${config.analytics.url}/ping`, { signal });
      if (!res.ok) throw new Error(`ping ${res.status}`);
    }, timeoutMs);
    return true;
  } catch { return false; }
}

// ClickHouse DateTime64(3) literal from a JS Date: 'YYYY-MM-DD HH:MM:SS.mmm' (UTC).
export function chDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
