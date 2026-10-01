import { NextResponse } from 'next/server';
import { Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { getPassenger } from '@/server/passenger';
import { exportPassengerData } from '@/server/passenger-data';

export const dynamic = 'force-dynamic';

// Download everything we hold about the signed-in passenger (GDPR access/portability).
export async function GET(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rl = await rateLimit('data-export', p.id || clientIp(req, config.trustedProxyHops), 5, 3600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const data = await exportPassengerData(p.id);
  if (!data) return Errors.notFound();
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="il-y-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store, private',
    },
  });
}
