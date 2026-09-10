import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Readiness: verifies essential DB access. No secrets exposed.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ready' });
  } catch {
    return NextResponse.json({ status: 'not-ready' }, { status: 503 });
  }
}
