import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness: the process is up. No sensitive diagnostics.
export function GET() {
  return NextResponse.json({ status: 'live' });
}
