// Next.js startup hook. Starts the in-process dispatch worker once, only in the Node
// runtime (never during build or on the edge). State lives in Postgres, so a restart
// recovers in-flight dispatch automatically.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DISPATCH_WORKER !== 'off') {
    const { startDispatchWorker } = await import('@/server/dispatch/worker');
    startDispatchWorker();
  }
}
