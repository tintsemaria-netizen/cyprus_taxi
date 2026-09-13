import { NextResponse } from 'next/server';
import { getDispatchHealth } from '@/server/dispatch/worker';

export const dynamic = 'force-dynamic';

// Liveness: the process is up. Exposes a non-secret release identifier so the
// deployed version can be verified, plus dispatch-worker liveness. No sensitive diagnostics.
export function GET() {
  const d = getDispatchHealth();
  return NextResponse.json({
    status: 'live',
    release: process.env.APP_RELEASE || 'dev',
    demoMode: (process.env.DEMO_MODE || 'true').toLowerCase() === 'true',
    dispatch: { alive: d.alive, lastTickAgoMs: d.lastTickAt ? Date.now() - d.lastTickAt : null },
  });
}
