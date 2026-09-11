import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness: the process is up. Exposes a non-secret release identifier so the
// deployed version can be verified. No sensitive diagnostics.
export function GET() {
  return NextResponse.json({
    status: 'live',
    release: process.env.APP_RELEASE || 'dev',
    demoMode: (process.env.DEMO_MODE || 'true').toLowerCase() === 'true',
  });
}
