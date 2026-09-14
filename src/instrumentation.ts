// Next.js startup hook. Starts the background worker loop once, only in the Node runtime
// (never during build or on the edge). State lives in Postgres, so a restart recovers
// in-flight dispatch automatically.
//
// Ownership (Task 016 §4): exactly one process runs the loop.
//   - Legacy single-process mode (DEDICATED_WORKERS != 'true'): the web process runs it.
//   - Dedicated mode (DEDICATED_WORKERS == 'true'): ONLY the process with WORKER_ROLE=worker
//     runs it; web processes skip it (no duplicate timers across web replicas + worker).
// DISPATCH_WORKER=off force-disables it anywhere (e.g. one-off maintenance containers).
//
// NOTE: the dynamic import MUST stay lexically inside the `NEXT_RUNTIME === 'nodejs'` guard —
// that is the pattern Next uses to node-gate it, so the worker's Node-only deps (web-push) are
// never bundled for the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DISPATCH_WORKER !== 'off') {
    const dedicated = process.env.DEDICATED_WORKERS === 'true';
    const isWorker = process.env.WORKER_ROLE === 'worker';
    if (dedicated && !isWorker) return; // web process in dedicated mode: do not run the loop
    const { startWorkers } = await import('@/server/dispatch/worker');
    startWorkers();
  }
}
