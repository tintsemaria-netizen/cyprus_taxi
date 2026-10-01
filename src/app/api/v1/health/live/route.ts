import { NextResponse } from 'next/server';
import { getDispatchHealth } from '@/server/dispatch/worker';
import { getHeartbeats } from '@/server/workers/heartbeat';

export const dynamic = 'force-dynamic';

const DISPATCH_STALE_MS = 15_000; // dispatch/notifications heartbeat older than this = not alive

// Liveness + operational health. Returns 503 (status "degraded") when the operational loop is not
// ticking — dispatch, and in dedicated-worker mode also notifications — so an external monitor
// (deploy/watchdog.sh → Telegram) can page. Docker's container healthcheck uses /health/ready
// (DB reachability), so a 503 here never triggers a container restart loop.
// The process is up. Exposes a non-secret release identifier so the deployed version
// can be verified, plus worker liveness. In dedicated-worker mode the loop ticks in a DIFFERENT
// process, so liveness comes from the WorkerHeartbeat table (cross-process), not a local timer.
// Operational health (dispatch + notifications) is reported SEPARATELY from analytics health, so
// a dead/absent analytics exporter never makes the booking path look down.
export async function GET() {
  const dedicated = process.env.DEDICATED_WORKERS === 'true';
  const now = Date.now();
  let dispatchAlive: boolean;
  let notificationsAlive = true;
  let lastTickAgoMs: number | null;
  let workers: Record<string, { ageMs: number; detail: unknown }> = {};

  if (dedicated) {
    try {
      const hbs = await getHeartbeats(new Date(now));
      for (const h of hbs) workers[h.role] = { ageMs: h.ageMs, detail: h.detail };
      const dispatch = workers['dispatch'];
      dispatchAlive = !!dispatch && dispatch.ageMs < DISPATCH_STALE_MS;
      lastTickAgoMs = dispatch ? dispatch.ageMs : null;
      const notif = workers['notifications'];
      notificationsAlive = !!notif && notif.ageMs < DISPATCH_STALE_MS;
    } catch {
      dispatchAlive = false; notificationsAlive = false; lastTickAgoMs = null;
    }
  } else {
    const d = getDispatchHealth();
    dispatchAlive = d.alive;
    lastTickAgoMs = d.lastTickAt ? now - d.lastTickAt : null;
  }

  // Analytics is an eventually-consistent projection: report it, but it does NOT gate liveness.
  const analytics = workers['analytics'] ? { alive: workers['analytics'].ageMs < 120_000, ageMs: workers['analytics'].ageMs } : { alive: false, ageMs: null };

  const ok = dispatchAlive && notificationsAlive;
  return NextResponse.json({
    status: ok ? 'live' : 'degraded',
    release: process.env.APP_RELEASE || 'dev',
    demoMode: (process.env.DEMO_MODE || 'true').toLowerCase() === 'true',
    mode: dedicated ? 'dedicated-workers' : 'embedded-worker',
    dispatch: { alive: dispatchAlive, lastTickAgoMs },
    notifications: { alive: notificationsAlive },
    analytics,
    ...(dedicated ? { workers } : {}),
  }, { status: ok ? 200 : 503 });
}
